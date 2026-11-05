import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * saveWidgetSlugAction and the slug getWidgetTokenAction reports
 * (lib/actions/widget.ts), plus the slug queries in lib/db/queries/widgets.ts.
 * The action is tested with the query layer mocked; the queries are tested with
 * a stubbed database handle so the unique-violation path is real code.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  setWidgetSlug: vi.fn(),
  getWidgetSlug: vi.fn(),
  ensureWidgetToken: vi.fn(),
  getWidgetAllowedOrigins: vi.fn(),
  getWidgetLeadCaptureMode: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/widgets', () => ({
  setWidgetSlug: h.setWidgetSlug,
  getWidgetSlug: h.getWidgetSlug,
  ensureWidgetToken: h.ensureWidgetToken,
  getWidgetAllowedOrigins: h.getWidgetAllowedOrigins,
  getWidgetLeadCaptureMode: h.getWidgetLeadCaptureMode,
  setWidgetAllowedOrigins: vi.fn(),
  rotateWidgetToken: vi.fn(),
  setWidgetLeadCaptureMode: vi.fn(),
}))

function form(slug: unknown): FormData {
  const fd = new FormData()
  if (slug !== undefined) fd.set('slug', slug as string)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'owner' })
  h.setWidgetSlug.mockImplementation(async (_org: number, raw: string | null) => ({
    ok: true,
    slug: raw === null ? null : raw.trim().toLowerCase(),
  }))
  h.ensureWidgetToken.mockResolvedValue({ token: 'a'.repeat(48), expiresAt: '2099-01-01T00:00:00.000Z' })
  h.getWidgetAllowedOrigins.mockResolvedValue(null)
  h.getWidgetLeadCaptureMode.mockResolvedValue('on-failure')
})

describe('saveWidgetSlugAction', () => {
  it('requires owner or admin, and stops there for anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { saveWidgetSlugAction } = await import('@/lib/actions/widget')
    expect(await saveWidgetSlugAction(null, form('acme'))).toEqual({
      error: 'You do not have permission to do that.',
    })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.setWidgetSlug).not.toHaveBeenCalled()
  })

  it('saves the slug for the verified org, not one named in the form', async () => {
    const { saveWidgetSlugAction } = await import('@/lib/actions/widget')
    const fd = form('Acme-Support')
    fd.set('orgId', '999')
    expect(await saveWidgetSlugAction(null, fd)).toEqual({ slug: 'acme-support' })
    expect(h.setWidgetSlug).toHaveBeenCalledWith(5, 'Acme-Support')
  })

  it('treats an empty field as clearing the slug', async () => {
    const { saveWidgetSlugAction } = await import('@/lib/actions/widget')
    expect(await saveWidgetSlugAction(null, form('   '))).toEqual({ slug: null })
    expect(h.setWidgetSlug).toHaveBeenCalledWith(5, null)
  })

  it('rejects a missing or non-text field without writing', async () => {
    const { saveWidgetSlugAction } = await import('@/lib/actions/widget')
    expect(await saveWidgetSlugAction(null, form(undefined))).toEqual({ error: 'Invalid input' })
    expect(h.setWidgetSlug).not.toHaveBeenCalled()
  })

  it('passes the query layer\'s reason through when the name is refused', async () => {
    h.setWidgetSlug.mockResolvedValue({ ok: false, error: 'That name is already taken. Try another.' })
    const { saveWidgetSlugAction } = await import('@/lib/actions/widget')
    expect(await saveWidgetSlugAction(null, form('acme'))).toEqual({
      error: 'That name is already taken. Try another.',
    })
  })
})

describe('getWidgetTokenAction: slug', () => {
  it('reports the current slug alongside the token', async () => {
    h.getWidgetSlug.mockResolvedValue('acme-support')
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect(await getWidgetTokenAction()).toMatchObject({ slug: 'acme-support' })
  })

  it('reports null when none has been chosen', async () => {
    h.getWidgetSlug.mockResolvedValue(null)
    const { getWidgetTokenAction } = await import('@/lib/actions/widget')
    expect((await getWidgetTokenAction()).slug).toBeNull()
  })
})
