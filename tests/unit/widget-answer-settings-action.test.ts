import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveWidgetAnswerScopeAction and saveWidgetGuidanceAction, and the two fields
 * getWidgetTokenAction now returns (lib/actions/widget.ts). Server actions can
 * be called directly with a crafted request, so what is checked here is that
 * the role gate runs first and the input is validated by the action itself.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  setWidgetAnswerScope: vi.fn(),
  setWidgetGuidance: vi.fn(),
  getWidgetAnswerSettings: vi.fn(),
  ensureWidgetToken: vi.fn(),
  getWidgetAllowedOrigins: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => true) }))
vi.mock('@/lib/db/queries/widget-logos', () => ({
  getWidgetLogoVersion: vi.fn(async () => null),
  getWidgetLogo: vi.fn(async () => null),
  setWidgetLogo: vi.fn(async () => ({ etag: '0123456789abcdef' })),
  deleteWidgetLogo: vi.fn(async () => undefined),
}))
vi.mock('@/lib/db/queries/widgets', () => ({
  getWidgetAppearance: vi.fn(async () => ({ title: null, welcome: null, brandColor: null })),
  setWidgetAppearance: vi.fn(),
  setWidgetAnswerScope: h.setWidgetAnswerScope,
  setWidgetGuidance: h.setWidgetGuidance,
  getWidgetAnswerSettings: h.getWidgetAnswerSettings,
  ensureWidgetToken: h.ensureWidgetToken,
  getWidgetAllowedOrigins: h.getWidgetAllowedOrigins,
  getWidgetLeadCaptureMode: vi.fn(async () => 'on-failure'),
  setWidgetLeadCaptureMode: vi.fn(),
  setWidgetAllowedOrigins: vi.fn(),
  rotateWidgetToken: vi.fn(),
  getWidgetSlug: vi.fn(async () => null),
  setWidgetSlug: vi.fn(),
}))
vi.mock('@/lib/widget/origin', () => ({ parseAllowedOrigins: (s: string) => s.split('\n').filter(Boolean) }))

const form = (field: string, value: unknown) => {
  const fd = new FormData()
  if (value !== undefined) fd.set(field, value as string)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'owner' })
  h.ensureWidgetToken.mockResolvedValue({ token: 'a'.repeat(48), expiresAt: '2099-01-01T00:00:00.000Z' })
  h.getWidgetAllowedOrigins.mockResolvedValue(null)
  h.getWidgetAnswerSettings.mockResolvedValue({ answerScope: 'knowledge-base-only', guidance: 'Be warm.' })
})

describe('saveWidgetAnswerScopeAction', () => {
  it('asks for an owner or admin, and stops there for anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { saveWidgetAnswerScopeAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAnswerScopeAction(null, form('scope', 'general'))
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.setWidgetAnswerScope).not.toHaveBeenCalled()
  })

  it('saves a valid scope for the caller’s own workspace', async () => {
    const { saveWidgetAnswerScopeAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetAnswerScopeAction(null, form('scope', 'knowledge-base-only'))
    expect(h.setWidgetAnswerScope).toHaveBeenCalledWith(5, 'knowledge-base-only')
    expect(result).toEqual({ scope: 'knowledge-base-only' })
  })

  it('refuses an unknown or missing scope without writing', async () => {
    const { saveWidgetAnswerScopeAction } = await import('@/lib/actions/widget')
    for (const bad of ['anything', '', undefined, 'GENERAL']) {
      const result = await saveWidgetAnswerScopeAction(null, form('scope', bad))
      expect(result, String(bad)).toEqual({ error: 'Invalid answer scope' })
    }
    expect(h.setWidgetAnswerScope).not.toHaveBeenCalled()
  })

  it('takes the workspace from the verified membership, never from the form', async () => {
    const { saveWidgetAnswerScopeAction } = await import('@/lib/actions/widget')
    const fd = form('scope', 'general')
    fd.set('orgId', '999')
    await saveWidgetAnswerScopeAction(null, fd)
    expect(h.setWidgetAnswerScope).toHaveBeenCalledWith(5, 'general')
  })
})

describe('saveWidgetGuidanceAction', () => {
  it('asks for an owner or admin, and stops there for anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { saveWidgetGuidanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetGuidanceAction(null, form('guidance', 'Be warm.'))
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.setWidgetGuidance).not.toHaveBeenCalled()
  })

  it('stores the cleaned note and reports exactly what was stored', async () => {
    const { saveWidgetGuidanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetGuidanceAction(null, form('guidance', '  Be warm.\r\n\r\n\r\nBe brief.  '))
    expect(h.setWidgetGuidance).toHaveBeenCalledWith(5, 'Be warm.\n\nBe brief.')
    expect(result).toEqual({ guidance: 'Be warm.\n\nBe brief.' })
  })

  it('clears the note when it is left empty', async () => {
    const { saveWidgetGuidanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetGuidanceAction(null, form('guidance', '   '))
    expect(h.setWidgetGuidance).toHaveBeenCalledWith(5, null)
    expect(result).toEqual({ guidance: null })
  })

  it('refuses an oversized note without writing', async () => {
    const { saveWidgetGuidanceAction } = await import('@/lib/actions/widget')
    const result = await saveWidgetGuidanceAction(null, form('guidance', 'x'.repeat(601)))
    expect(result).toEqual({ error: 'Keep guidance under 600 characters' })
    expect(h.setWidgetGuidance).not.toHaveBeenCalled()
  })
})

describe('getWidgetTokenAction for a member who is not an owner or admin', () => {
  it('still reports the settings, but not as something they can change', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'member' })
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    const result = await getWidgetTokenAction()
    expect(result.answerScope).toBe('knowledge-base-only')
    expect(result.guidance).toBe('Be warm.')
    expect(result.canManage).toBe(false)
  })
})

describe('getWidgetTokenAction', () => {
  it('reports the answer scope and the note, so Settings shows what is saved', async () => {
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    const result = await getWidgetTokenAction()
    expect(result.answerScope).toBe('knowledge-base-only')
    expect(result.guidance).toBe('Be warm.')
  })
})
