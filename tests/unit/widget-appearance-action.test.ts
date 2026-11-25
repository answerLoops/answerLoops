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
  getWidgetLogoVersion: vi.fn(),
  deleteWidgetLogo: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widget-logos', () => ({
  getWidgetLogoVersion: h.getWidgetLogoVersion,
  getWidgetLogo: vi.fn(async () => null),
  setWidgetLogo: vi.fn(async () => ({ etag: '0123456789abcdef' })),
  deleteWidgetLogo: h.deleteWidgetLogo,
}))
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
  h.getWidgetLogoVersion.mockResolvedValue(null)
  h.deleteWidgetLogo.mockResolvedValue(undefined)
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'owner' })
  h.orgHasFeature.mockResolvedValue(true)
  h.ensureWidgetToken.mockResolvedValue({ token: 'a'.repeat(48), expiresAt: '2099-01-01T00:00:00.000Z' })
  h.getWidgetAllowedOrigins.mockResolvedValue(null)
  h.getWidgetAppearance.mockResolvedValue({ title: 'Acme Help', welcome: null, brandColor: '#ffd60a', starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
  h.setWidgetAppearance.mockImplementation(async (_org: number, v: { title: string | null; welcome: string | null; brandColor: string | null; starterQuestions: string[]; starterEnabled: boolean }) => v)
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

  it('refuses a plan without customization even when only the follow-up switch is being changed', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAppearanceAction(null, form({ followUpsEnabled: 'false' }))
    expect(result.error).toMatch(/Pro and above/)
    expect(h.setWidgetAppearance).not.toHaveBeenCalled()
  })

  it('saves the cleaned values for the caller’s own workspace and reports what was stored', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAppearanceAction(
      null,
      form({
        title: '  Acme   Help ',
        welcome: 'Hi! Ask us anything.',
        brandColor: ' #FFD60A ',
        starterQuestions: ' How does it work? \r\n\r\nWhat does it cost?\nhow does it work?',
      })
    )
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, {
      title: 'Acme Help',
      welcome: 'Hi! Ask us anything.',
      brandColor: '#ffd60a',
      starterQuestions: ['How does it work?', 'What does it cost?'],
      starterEnabled: true,
      followUpsEnabled: true,
    })
    expect(result).toEqual({
      appearance: {
        title: 'Acme Help',
        welcome: 'Hi! Ask us anything.',
        brandColor: '#ffd60a',
        starterQuestions: ['How does it work?', 'What does it cost?'],
        starterEnabled: true,
        followUpsEnabled: true,
      },
    })
  })

  it('treats empty fields as "use the default"', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await saveWidgetAppearanceAction(null, form({ title: '', welcome: '  ', brandColor: '', starterQuestions: ' \n ' }))
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, {
      title: null,
      welcome: null,
      brandColor: null,
      starterQuestions: [],
      starterEnabled: true,
      followUpsEnabled: true,
    })
  })

  it('saves the follow-up suggestions switch: off only when the form says so, on otherwise', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await saveWidgetAppearanceAction(null, form({ followUpsEnabled: 'false' }))
    expect(h.setWidgetAppearance).toHaveBeenLastCalledWith(5, expect.objectContaining({ followUpsEnabled: false }))
    await saveWidgetAppearanceAction(null, form({ followUpsEnabled: 'true' }))
    expect(h.setWidgetAppearance).toHaveBeenLastCalledWith(5, expect.objectContaining({ followUpsEnabled: true }))
    await saveWidgetAppearanceAction(null, form({}))
    expect(h.setWidgetAppearance).toHaveBeenLastCalledWith(5, expect.objectContaining({ followUpsEnabled: true }))
  })

  it('saves the starter-question switch: off only when the form says so, on otherwise', async () => {
    const { saveWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await saveWidgetAppearanceAction(null, form({ starterQuestions: 'How does it work?', starterEnabled: 'false' }))
    expect(h.setWidgetAppearance).toHaveBeenLastCalledWith(
      5,
      expect.objectContaining({ starterQuestions: ['How does it work?'], starterEnabled: false, followUpsEnabled: true })
    )
    await saveWidgetAppearanceAction(null, form({ starterQuestions: 'How does it work?', starterEnabled: 'true' }))
    expect(h.setWidgetAppearance).toHaveBeenLastCalledWith(5, expect.objectContaining({ starterEnabled: true, followUpsEnabled: true }))
    await saveWidgetAppearanceAction(null, form({ starterQuestions: 'How does it work?' }))
    expect(h.setWidgetAppearance).toHaveBeenLastCalledWith(5, expect.objectContaining({ starterEnabled: true, followUpsEnabled: true }))
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
    const limit = 'Use up to 4 starter questions, 80 characters each.'
    expect(await saveWidgetAppearanceAction(null, form({ starterQuestions: 'a\nb\nc\nd\ne' }))).toEqual({
      field: 'starterQuestions',
      error: limit,
    })
    expect(await saveWidgetAppearanceAction(null, form({ starterQuestions: 'q'.repeat(81) }))).toEqual({
      field: 'starterQuestions',
      error: limit,
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

  it('clears all four values for the caller’s workspace', async () => {
    const { resetWidgetAppearanceAction } = await import('@/lib/actions/widget')
    const result = await resetWidgetAppearanceAction()
    expect(h.setWidgetAppearance).toHaveBeenCalledWith(5, {
      title: null,
      welcome: null,
      brandColor: null,
      starterQuestions: [],
      starterEnabled: true,
      followUpsEnabled: true,
    })
    expect(result).toEqual({
      appearance: { title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true },
    })
  })
})

describe('getWidgetTokenAction', () => {
  it('reports the saved appearance and whether the plan includes customization', async () => {
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    const result = await getWidgetTokenAction()
    expect(result.appearance).toEqual({ title: 'Acme Help', welcome: null, brandColor: '#ffd60a', starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
    expect(result.customizationAvailable).toBe(true)
    expect(h.orgHasFeature).toHaveBeenCalledWith(5, 'white_label_widget')
  })

  it('reports customization as unavailable on a plan without it', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect((await getWidgetTokenAction()).customizationAvailable).toBe(false)
  })
})


describe('the logo, in the reset and in the settings lookup', () => {
  it('Reset to default also removes the logo, for the caller\'s workspace only', async () => {
    const { resetWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await resetWidgetAppearanceAction()
    expect(h.deleteWidgetLogo).toHaveBeenCalledTimes(1)
    expect(h.deleteWidgetLogo).toHaveBeenCalledWith(5)
  })

  it('a refused reset leaves the logo alone', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { resetWidgetAppearanceAction } = await import('@/lib/actions/widget')
    await resetWidgetAppearanceAction()
    expect(h.deleteWidgetLogo).not.toHaveBeenCalled()
  })

  it('reports the logo\'s address to Settings when the plan includes customization', async () => {
    h.ensureWidgetToken.mockResolvedValue({ token: 'd4'.repeat(24), expiresAt: '2036-01-01T00:00:00.000Z' })
    h.getWidgetLogoVersion.mockResolvedValue({ etag: '0123456789abcdef' })
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect((await getWidgetTokenAction()).logoUrl).toBe(`/api/widget/logo/${'d4'.repeat(24)}?v=0123456789abcdef`)
  })

  it('reports none when the workspace has no logo', async () => {
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect((await getWidgetTokenAction()).logoUrl).toBeNull()
  })

  it('reports none, and does not look, on a plan without customization', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    h.getWidgetLogoVersion.mockResolvedValue({ etag: '0123456789abcdef' })
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect((await getWidgetTokenAction()).logoUrl).toBeNull()
    expect(h.getWidgetLogoVersion).not.toHaveBeenCalled()
  })
})
