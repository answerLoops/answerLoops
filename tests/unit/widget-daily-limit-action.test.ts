import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveWidgetDailyLimitAction and the daily-limit fields getWidgetTokenAction
 * reports (lib/actions/widget.ts). The query layer is mocked; its own
 * validation is covered by widget-daily-limit-migration.test.ts.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  setWidgetDailyAnswerLimit: vi.fn(),
  getWidgetDailyAnswerLimit: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/db/queries/widget-logos', () => ({
  getWidgetLogoVersion: vi.fn(async () => null),
  deleteWidgetLogo: vi.fn(async () => undefined),
}))
vi.mock('@/lib/db/queries/widgets', () => ({
  getWidgetAppearance: vi.fn(async () => ({ title: null, welcome: null, brandColor: null })),
  getWidgetDailyAnswerLimit: h.getWidgetDailyAnswerLimit,
  setWidgetDailyAnswerLimit: h.setWidgetDailyAnswerLimit,
  setWidgetAppearance: vi.fn(),
  setWidgetSlug: vi.fn(),
  getWidgetSlug: vi.fn(async () => null),
  ensureWidgetToken: vi.fn(async () => ({ token: 'b2'.repeat(24), expiresAt: '2099-01-01T00:00:00.000Z' })),
  getWidgetAllowedOrigins: vi.fn(async () => null),
  getWidgetLeadCaptureMode: vi.fn(async () => 'on-failure'),
  setWidgetAllowedOrigins: vi.fn(),
  rotateWidgetToken: vi.fn(),
  setWidgetLeadCaptureMode: vi.fn(),
  getWidgetAnswerSettings: vi.fn(async () => ({ answerScope: 'general', guidance: null })),
  setWidgetAnswerScope: vi.fn(),
  setWidgetGuidance: vi.fn(),
}))

function form(limit?: string | Blob): FormData {
  const fd = new FormData()
  if (limit !== undefined) fd.set('limit', limit)
  return fd
}

const action = async () => (await import('@/lib/actions/widget')).saveWidgetDailyLimitAction

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '')
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'owner' })
  h.setWidgetDailyAnswerLimit.mockResolvedValue(undefined)
  h.getWidgetDailyAnswerLimit.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('saveWidgetDailyLimitAction', () => {
  it('requires owner or admin and saves nothing for anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await (await action())(null, form('100'))).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.setWidgetDailyAnswerLimit).not.toHaveBeenCalled()
  })

  it("stores the normalized number for the caller's own org, ignoring any org in the form", async () => {
    const fd = form(' 1,200 ')
    fd.set('orgId', '999')
    expect(await (await action())(null, fd)).toEqual({ limit: 1_200 })
    expect(h.setWidgetDailyAnswerLimit).toHaveBeenCalledWith(5, 1_200)
  })

  it('clears the limit when the field is empty or missing', async () => {
    expect(await (await action())(null, form(''))).toEqual({ limit: null })
    expect(h.setWidgetDailyAnswerLimit).toHaveBeenLastCalledWith(5, null)
    expect(await (await action())(null, form())).toEqual({ limit: null })
    expect(h.setWidgetDailyAnswerLimit).toHaveBeenLastCalledWith(5, null)
  })

  it.each(['abc', '0', '-4', '2.5'])('refuses %j and saves nothing', async (raw) => {
    const result = await (await action())(null, form(raw))
    expect(result.error).toBeTruthy()
    expect(result.limit).toBeUndefined()
    expect(h.setWidgetDailyAnswerLimit).not.toHaveBeenCalled()
  })

  it("checks against this instance's ceiling, not a fixed number", async () => {
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '800')
    const save = await action()
    expect(await save(null, form('801'))).toEqual({
      error: 'This instance allows at most 800 answers a day per workspace.',
    })
    expect(h.setWidgetDailyAnswerLimit).not.toHaveBeenCalled()
    expect(await save(null, form('800'))).toEqual({ limit: 800 })
  })

  it('refuses a file upload in place of text', async () => {
    const result = await (await action())(null, form(new Blob(['100'])))
    expect(result).toEqual({ error: 'Invalid input' })
    expect(h.setWidgetDailyAnswerLimit).not.toHaveBeenCalled()
  })
})

describe('getWidgetTokenAction: daily limit fields', () => {
  it("reports the owner's limit and the instance ceiling", async () => {
    h.getWidgetDailyAnswerLimit.mockResolvedValue(450)
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '2000')
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    const result = await getWidgetTokenAction()
    expect(h.getWidgetDailyAnswerLimit).toHaveBeenCalledWith(5)
    expect(result).toMatchObject({ dailyAnswerLimit: 450, dailyAnswerCeiling: 2_000 })
  })

  it('reports null and the default ceiling when nothing is set', async () => {
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect(await getWidgetTokenAction()).toMatchObject({ dailyAnswerLimit: null, dailyAnswerCeiling: 3_000 })
  })
})
