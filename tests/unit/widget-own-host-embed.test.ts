import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * mayOpenOnOwnHost (lib/widget/own-host-embed.ts): which widgets may open on
 * this instance's own host without that host being in their allowed domains.
 * Self-hosted: every widget. Hosted service: the site's own widget
 * (SITE_CHAT_WIDGET_ID, by token or slug), and otherwise only for a signed-in
 * member of the widget's workspace.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  isOrgMember: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/auth/membership', () => ({ isOrgMember: h.isOrgMember }))

const TOKEN = 'd4'.repeat(24)
const OTHER_TOKEN = 'e5'.repeat(24)
const org = { id: 7, widget_slug: 'acme-help' as string | null }

const subject = async () => (await import('@/lib/widget/own-host-embed')).mayOpenOnOwnHost

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  vi.stubEnv('SITE_CHAT_WIDGET_ID', '')
  h.auth.mockResolvedValue(null)
  h.isOrgMember.mockResolvedValue(false)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mayOpenOnOwnHost', () => {
  it('allows every widget on a self-hosted instance, without looking at the session', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
    expect(await (await subject())(org, TOKEN)).toBe(true)
    vi.stubEnv('DEPLOYMENT_MODE', '')
    expect(await (await subject())(org, TOKEN)).toBe(true)
    expect(h.auth).not.toHaveBeenCalled()
  })

  it("allows the hosted site's own widget when it is configured by token", async () => {
    vi.stubEnv('SITE_CHAT_WIDGET_ID', TOKEN)
    expect(await (await subject())(org, TOKEN)).toBe(true)
    expect(h.auth).not.toHaveBeenCalled()
  })

  it("allows the hosted site's own widget when it is configured by slug", async () => {
    vi.stubEnv('SITE_CHAT_WIDGET_ID', 'acme-help')
    expect(await (await subject())(org, TOKEN)).toBe(true)
    expect(h.auth).not.toHaveBeenCalled()
  })

  it("does not treat another widget as the site's own", async () => {
    vi.stubEnv('SITE_CHAT_WIDGET_ID', OTHER_TOKEN)
    expect(await (await subject())(org, TOKEN)).toBe(false)
    vi.stubEnv('SITE_CHAT_WIDGET_ID', 'other-help')
    expect(await (await subject())(org, TOKEN)).toBe(false)
    // A widget with no slug never matches a slug setting.
    expect(await (await subject())({ id: 7, widget_slug: null }, TOKEN)).toBe(false)
  })

  it('refuses a visitor who is not signed in', async () => {
    h.auth.mockResolvedValue(null)
    expect(await (await subject())(org, TOKEN)).toBe(false)
    expect(h.isOrgMember).not.toHaveBeenCalled()
  })

  it('refuses a session with no user id', async () => {
    h.auth.mockResolvedValue({ user: {} })
    expect(await (await subject())(org, TOKEN)).toBe(false)
    expect(h.isOrgMember).not.toHaveBeenCalled()
  })

  it("allows a signed-in member of the widget's workspace", async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.isOrgMember.mockResolvedValue(true)
    expect(await (await subject())(org, TOKEN)).toBe(true)
    expect(h.isOrgMember).toHaveBeenCalledWith('user-1', 7)
  })

  it('refuses a signed-in user who is not a member of that workspace', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-2' } })
    h.isOrgMember.mockResolvedValue(false)
    expect(await (await subject())(org, TOKEN)).toBe(false)
    expect(h.isOrgMember).toHaveBeenCalledWith('user-2', 7)
  })
})
