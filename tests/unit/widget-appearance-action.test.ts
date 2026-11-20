import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveWidgetAppearanceAction and resetWidgetAppearanceAction, and the two
 * fields getWidgetTokenAction returns for them (lib/actions/widget.ts). Server
 * actions can be called directly with a crafted request, so what is checked
 * here is that the role gate and the plan check run first, the workspace comes
 * from the verified membership, and the action validates its own input.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  orgHasFeature: vi.fn(),
  setWidgetAppearance: vi.fn(),
  getWidgetAppearance: vi.fn(),
  ensureWidgetToken: vi.fn(),
  getWidgetAllowedOrigins: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widgets', () => ({
  setWidgetAppearance: h.setWidgetAppearance,
  getWidgetAppearance: h.getWidgetAppearance,
  ensureWidgetToken: h.ensureWidgetToken,
  getWidgetAllowedOrigins: h.getWidgetAllowedOrigins,
  getWidgetLeadCaptureMode: vi.fn(async () => 'on-failure'),
  getWidgetAnswerSettings: vi.fn(async () => ({ answerScope: 'general', guidance: null })),
  getWidgetSlug: vi.fn(async () => null),
  setWidgetLeadCaptureMode: vi.fn(),
  setWidgetAllowedOrigins: vi.fn(),
  rotateWidgetToken: vi.fn(),
  setWidgetAnswerScope: vi.fn(),
  setWidgetGuidance: vi.fn(),
  setWidgetSlug: vi.fn(),
}))
vi.mock('@/lib/widget/origin', () => ({ parseAllowedOrigins: (s: string) => s.split('\n').filter(Boolean) }))

const form = (values: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(values)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'owner' })
  h.orgHasFeature.mockResolvedValue(true)
  h.ensureWidgetToken.mockResolvedValue({ token: 'a'.repeat(48), expiresAt: '2099-01-01T00:00:00.000Z' })
  h.getWidgetAllowedOrigins.mockResolvedValue(null)
  h.getWidgetAppearance.mockResolvedValue({ title: 'Acme Help', welcome: null, brandColor: '#ffd60a' })
  h.setWidgetAppearance.mockImplementation(async (_org: number, v: { title: string | null; welcome: string | null; brandColor: string | null }) => v)
})

describe('saveWidgetAppearanceAction', () => {
  it('asks for an owner or admin, and stops there for anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAppearanceAction(null, form({ title: 'Acme' }))
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.orgHasFeature).not.toHaveBeenCalled()
    expect(h.setWidgetAppearance).not.toHaveBeenCalled()
  })

  it('refuses a workspace whose plan does not include customization, without writing', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAppearanceAction(null, form({ title: 'Acme', brandColor: '#ffd60a' }))
    expect(h.orgHasFeature).toHaveBeenCalledWith(5, 'white_label_widget')
    expect(result.error).toMatch(/Pro and above/)
    expect(h.setWidgetAppearance).not.toHaveBeenCalled()
  })

  it('saves the cleaned values for the caller’s own workspace and reports what was stored', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAppearanceAction(
      null,
      form({ title: '  Acme   Help ', welcome: 'Hi! Ask us anything.', brandColor: ' #FFD60A ' })
    )
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, {
      title: 'Acme Help',
      welcome: 'Hi! Ask us anything.',
      brandColor: '#ffd60a',
    })
    expect(result).toEqual({
      appearance: { title: 'Acme Help', welcome: 'Hi! Ask us anything.', brandColor: '#ffd60a' },
    })
  })

  it('treats empty fields as "use the default"', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await saveWidgetAppearanceAction(null, form({ title: '', welcome: '  ', brandColor: '' }))
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, { title: null, welcome: null, brandColor: null })
  })

  it('names the field and gives a plain message for each kind of bad input, without writing', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    expect(await saveWidgetAppearanceAction(null, form({ title: 't'.repeat(61) }))).toEqual({
      field: 'title',
      error: 'Keep the chat title under 60 characters',
    })
    expect(await saveWidgetAppearanceAction(null, form({ welcome: 'w'.repeat(201) }))).toEqual({
      field: 'welcome',
      error: 'Keep the welcome message under 200 characters',
    })
    for (const bad of ['red', '#fff', 'url(javascript:alert(1))', '#12345g', 'rgb(1,2,3)']) {
      expect(await saveWidgetAppearanceAction(null, form({ brandColor: bad }))).toEqual({
        field: 'brandColor',
        error: 'Choose a color like #1a73e8.',
      })
    }
    expect(h.setWidgetAppearance).not.toHaveBeenCalled()
  })

  it('takes the workspace from the verified membership, never from the form', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await saveWidgetAppearanceAction(null, form({ title: 'Acme', orgId: '999', org_id: '999' }))
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Acme' }))
    expect(h.setWidgetAppearance.mock.calls[0][0]).toBe(5)
  })
})

describe('resetWidgetAppearanceAction', () => {
  it('asks for an owner or admin, and stops there for anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { resetWidgetAppearanceAction } = await import('@/lib/actions/widget')
    expect(await resetWidgetAppearanceAction()).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.setWidgetAppearance).not.toHaveBeenCalled()
  })

  it('refuses a workspace whose plan does not include customization', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { resetWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await resetWidgetAppearanceAction()
    expect(result.error).toMatch(/Pro and above/)
    expect(h.setWidgetAppearance).not.toHaveBeenCalled()
  })

  it('clears all three values for the caller’s workspace', async () => {
    const { resetWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await resetWidgetAppearanceAction()
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, { title: null, welcome: null, brandColor: null })
    expect(result).toEqual({ appearance: { title: null, welcome: null, brandColor: null } })
  })
})

describe('getWidgetTokenAction', () => {
  it('reports the saved appearance and whether the plan includes customization', async () => {
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    const result = await getWidgetTokenAction()
    expect(result.appearance).toEqual({ title: 'Acme Help', welcome: null, brandColor: '#ffd60a' })
    expect(result.customizationAvailable).toBe(true)
    expect(h.orgHasFeature).toHaveBeenCalledWith(5, 'white_label_widget')
  })

  it('reports customization as unavailable on a plan without it', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect((await getWidgetTokenAction()).customizationAvailable).toBe(false)
  })
})
