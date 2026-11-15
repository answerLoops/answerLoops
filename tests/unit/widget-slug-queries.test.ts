import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The slug queries in lib/db/queries/widgets.ts. The database handle is a
 * chainable stub: what matters here is what the query layer validates before
 * writing and how it reports a name another workspace already holds.
 */

const db = vi.hoisted(() => {
  const state = { updateError: null as unknown, selectRows: [] as unknown[], setValues: [] as unknown[] }
  const handle = {
    update: () => ({
      set: (values: unknown) => {
        state.setValues.push(values)
        return {
          where: async () => {
            if (state.updateError) throw state.updateError
          },
        }
      },
    }),
    select: () => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.leftJoin = () => chain
      chain.where = () => chain
      chain.limit = async () => state.selectRows
      return chain
    },
  }
  return { state, handle }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => db.handle }))
vi.mock('../../lib/db/drizzle', () => ({ getDb: () => db.handle }))

beforeEach(() => {
  db.state.updateError = null
  db.state.selectRows = []
  db.state.setValues = []
})

describe('setWidgetSlug', () => {
  it('stores the normalised slug', async () => {
    const { setWidgetSlug } = await import('@/lib/db/queries/widgets')
    expect(await setWidgetSlug(5, '  Acme-Support ')).toEqual({ ok: true, slug: 'acme-support' })
    expect(db.state.setValues).toEqual([{ widgetSlug: 'acme-support' }])
  })

  it('clears the slug with null', async () => {
    const { setWidgetSlug } = await import('@/lib/db/queries/widgets')
    expect(await setWidgetSlug(5, null)).toEqual({ ok: true, slug: null })
    expect(db.state.setValues).toEqual([{ widgetSlug: null }])
  })

  it('refuses an invalid name without writing', async () => {
    const { setWidgetSlug } = await import('@/lib/db/queries/widgets')
    const result = await setWidgetSlug(5, 'No Spaces Allowed')
    expect(result.ok).toBe(false)
    expect(db.state.setValues).toEqual([])
  })

  it('reports a name another workspace holds as taken, not as a crash', async () => {
    db.state.updateError = Object.assign(new Error('duplicate key'), { code: '23505' })
    const { setWidgetSlug } = await import('@/lib/db/queries/widgets')
    expect(await setWidgetSlug(5, 'acme')).toEqual({
      ok: false,
      error: 'That name is already taken. Try another.',
    })
  })

  it('does not swallow other database failures', async () => {
    db.state.updateError = new Error('connection reset')
    const { setWidgetSlug } = await import('@/lib/db/queries/widgets')
    await expect(setWidgetSlug(5, 'acme')).rejects.toThrow('connection reset')
  })
})

describe('getWidgetSlug / getOrgByWidgetSlug', () => {
  it('returns the stored slug, or null when none is set', async () => {
    const { getWidgetSlug } = await import('@/lib/db/queries/widgets')
    db.state.selectRows = [{ slug: 'acme' }]
    expect(await getWidgetSlug(5)).toBe('acme')
    db.state.selectRows = [{ slug: null }]
    expect(await getWidgetSlug(5)).toBeNull()
    db.state.selectRows = []
    expect(await getWidgetSlug(5)).toBeNull()
  })

  it('resolves a slug under the same rules as a token', async () => {
    const { getOrgByWidgetSlug } = await import('@/lib/db/queries/widgets')
    db.state.selectRows = [
      {
        id: 5,
        name: 'Acme',
        widget_token: 'c3'.repeat(24),
        widget_token_expires_at: '2099-01-01T00:00:00.000Z',
        widget_allowed_origins: null,
        widget_lead_capture_mode: 'on-failure',
        plan_id: 'pro',
      },
    ]
    expect(await getOrgByWidgetSlug('acme')).toMatchObject({ id: 5, widget_token: 'c3'.repeat(24) })
  })

  it('resolves to nothing when the token behind the slug has expired', async () => {
    const { getOrgByWidgetSlug } = await import('@/lib/db/queries/widgets')
    db.state.selectRows = [
      {
        id: 5,
        name: 'Acme',
        widget_token: 'c3'.repeat(24),
        widget_token_expires_at: '2000-01-01T00:00:00.000Z',
        widget_allowed_origins: null,
        widget_lead_capture_mode: 'on-failure',
        plan_id: 'pro',
      },
    ]
    expect(await getOrgByWidgetSlug('acme')).toBeNull()
  })

  it('resolves to nothing for an unknown slug', async () => {
    const { getOrgByWidgetSlug } = await import('@/lib/db/queries/widgets')
    expect(await getOrgByWidgetSlug('nobody')).toBeNull()
  })
})
