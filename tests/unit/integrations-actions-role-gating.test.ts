import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Every integration action that changes an org's connections is limited to
// owners and admins, and takes its org from a real membership row — never
// from a session value with a default-org fallback.

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  upsertIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  getIntegration: vi.fn(async () => null),
  issueGoogleChatPairingCode: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({
  upsertIntegration: h.upsertIntegration,
  deleteIntegration: h.deleteIntegration,
  getIntegration: h.getIntegration,
  issueGoogleChatPairingCode: h.issueGoogleChatPairingCode,
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => true) }))
vi.mock('@/lib/db/queries/discord-guilds', () => ({ updateDiscordGuildChannels: vi.fn(), removeDiscordGuild: vi.fn() }))
vi.mock('@/lib/db/queries/email-domains', () => ({
  getEmailDomain: vi.fn(async () => null), upsertEmailDomain: vi.fn(), updateEmailDomainStatus: vi.fn(), deleteEmailDomain: vi.fn(),
}))
vi.mock('@/lib/email/domain', () => ({ registerDomain: vi.fn(), checkDomainStatus: vi.fn(), removeDomain: vi.fn() }))
vi.mock('@/lib/db/queries/email-oauth', () => ({ getEmailOauthConnection: vi.fn(async () => null), deleteEmailOauthConnection: vi.fn() }))
vi.mock('@/lib/email/gmail', () => ({ revokeGmailToken: vi.fn() }))
vi.mock('@/lib/email/outlook', () => ({ revokeOutlookToken: vi.fn() }))
vi.mock('@/lib/telegram/webhook', () => ({ registerTelegramWebhook: vi.fn() }))

const src = fs.readFileSync(path.join(process.cwd(), 'lib/actions/integrations.ts'), 'utf-8')

describe('lib/actions/integrations.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no longer reads the org from the session or falls back to the default org', () => {
    expect(src).not.toContain('session.orgId')
    expect(src).not.toContain('DEFAULT_ORG_ID')
    expect(src).not.toMatch(/await auth\(\)/)
  })

  it('gates every exported action on owner/admin membership', () => {
    const actions = [...src.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1])
    expect(actions.length).toBeGreaterThan(20)
    for (const name of actions) {
      const start = src.indexOf(`export async function ${name}(`)
      const next = src.indexOf('\nexport async function', start + 1)
      const body = src.slice(start, next === -1 ? undefined : next)
      expect(body, `${name} must call requireOrgAccess(['owner', 'admin'])`).toContain("requireOrgAccess(['owner', 'admin'])")
    }
  })

  it.each([
    ['deleteDiscordIntegrationAction', 'deleteIntegration'],
    ['deleteSlackIntegrationAction', 'deleteIntegration'],
    ['deleteTelegramIntegrationAction', 'deleteIntegration'],
    ['deleteCircleIntegrationAction', 'deleteIntegration'],
  ])('%s does nothing for a plain member', async (name) => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const actions = (await import('@/lib/actions/integrations')) as unknown as Record<string, (p: unknown, f: FormData) => Promise<{ error?: string } | null>>
    const result = await actions[name](null, new FormData())
    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.deleteIntegration).not.toHaveBeenCalled()
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('a save action uses the org from the membership check, not anything the caller supplies', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 42, userId: 1, role: 'admin' })
    const { saveGoogleChatSettingsAction } = await import('@/lib/actions/integrations')
    const form = new FormData()
    form.set('orgId', '1')
    await saveGoogleChatSettingsAction(null, form)
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ orgId: 42, platform: 'google_chat' }))
  })

  it('refuses the Google Chat code request for a member, and issues it for an admin', async () => {
    const { generateGoogleChatConnectCodeAction } = await import('@/lib/actions/integrations')
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await generateGoogleChatConnectCodeAction(null, new FormData())).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.issueGoogleChatPairingCode).not.toHaveBeenCalled()

    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9, userId: 2, role: 'owner' })
    h.issueGoogleChatPairingCode.mockResolvedValue({ status: 'issued', code: 'gc_x' })
    expect(await generateGoogleChatConnectCodeAction(null, new FormData())).toEqual({ connectCode: 'gc_x' })
    expect(h.issueGoogleChatPairingCode).toHaveBeenCalledWith(9, expect.stringMatching(/^gc_[0-9a-f]{24}$/))
  })
})
