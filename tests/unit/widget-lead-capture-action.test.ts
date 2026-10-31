import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Behavioral coverage for saveWidgetLeadCaptureModeAction and the
 * leadCaptureMode field getWidgetTokenAction now returns (both in
 * lib/actions/widget.ts) — not just the source-level gating assertion in
 * widget-surface-hardening.test.ts. requireOrgAccess and the query layer are
 * mocked directly; the action itself is a plain exported async function
 * ('use server' marks it callable from a client component, it does not stop
 * a test from importing and calling it like any other function).
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getWidgetLeadCaptureMode: vi.fn(),
  setWidgetLeadCaptureMode: vi.fn(),
  ensureWidgetToken: vi.fn(),
  getWidgetAllowedOrigins: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/widgets', () => ({
  getWidgetLeadCaptureMode: h.getWidgetLeadCaptureMode,
  setWidgetLeadCaptureMode: h.setWidgetLeadCaptureMode,
  ensureWidgetToken: h.ensureWidgetToken,
  getWidgetAllowedOrigins: h.getWidgetAllowedOrigins,
  setWidgetAllowedOrigins: vi.fn(),
  rotateWidgetToken: vi.fn(),
}))
vi.mock('@/lib/widget/origin', () => ({ parseAllowedOrigins: (s: string) => s.split('\n').filter(Boolean) }))

function formWith(mode: unknown): FormData {
  const fd = new FormData()
  if (mode !== undefined) fd.set('mode', mode as string)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ensureWidgetToken.mockResolvedValue({ token: 'a'.repeat(48), expiresAt: '2099-01-01T00:00:00.000Z' })
  h.getWidgetAllowedOrigins.mockResolvedValue(null)
})

describe('saveWidgetLeadCaptureModeAction', () => {
  it('rejects a non-owner/admin before touching the query layer', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { saveWidgetLeadCaptureModeAction } = await import('@/lib/actions/widget')

    const result = await saveWidgetLeadCaptureModeAction(null, formWith('on-failure'))

    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.setWidgetLeadCaptureMode).not.toHaveBeenCalled()
  })

  it('requires owner/admin specifically, not bare membership', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { saveWidgetLeadCaptureModeAction } = await import('@/lib/actions/widget')
    await saveWidgetLeadCaptureModeAction(null, formWith('on-failure'))
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it.each(['always-on', '', 'ON-FAILURE', null, undefined])(
    'rejects an invalid mode (%s) without ever calling the query layer',
    async (mode) => {
      h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })
      const { saveWidgetLeadCaptureModeAction } = await import('@/lib/actions/widget')

      const result = await saveWidgetLeadCaptureModeAction(null, formWith(mode))

      expect(result).toEqual({ error: 'Invalid mode' })
      expect(h.setWidgetLeadCaptureMode).not.toHaveBeenCalled()
    }
  )

  it.each(['off', 'on-failure', 'up-front'] as const)(
    'accepts the valid mode %s, saves it for the caller\'s org, and returns it',
    async (mode) => {
      h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'admin' })
      const { saveWidgetLeadCaptureModeAction } = await import('@/lib/actions/widget')

      const result = await saveWidgetLeadCaptureModeAction(null, formWith(mode))

      expect(result).toEqual({ mode })
      expect(h.setWidgetLeadCaptureMode).toHaveBeenCalledWith(7, mode)
    }
  )
})

describe('getWidgetTokenAction: leadCaptureMode', () => {
  it('includes the org\'s current lead-capture mode in the result', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'member' })
    h.getWidgetLeadCaptureMode.mockResolvedValue('on-failure')
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')

    const result = await getWidgetTokenAction()

    expect(result.leadCaptureMode).toBe('on-failure')
    expect(h.getWidgetLeadCaptureMode).toHaveBeenCalledWith(7)
  })

  it('reflects whatever mode the query layer reports, including up-front', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9, userId: 1, role: 'owner' })
    h.getWidgetLeadCaptureMode.mockResolvedValue('up-front')
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')

    const result = await getWidgetTokenAction()

    expect(result.leadCaptureMode).toBe('up-front')
  })
})
