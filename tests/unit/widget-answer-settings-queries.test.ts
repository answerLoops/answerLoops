import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The answer-scope and guidance queries in lib/db/queries/widgets.ts. The
 * database handle is a chainable stub: what matters is what the query layer
 * validates before writing and how it reads back what is stored.
 */

const db = vi.hoisted(() => {
  const state = { selectRows: [] as unknown[], setValues: [] as unknown[] }
  const handle = {
    update: () => ({
      set: (values: unknown) => {
        state.setValues.push(values)
        return { where: async () => undefined }
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
  db.state.selectRows = []
  db.state.setValues = []
})

describe('setWidgetAnswerScope', () => {
  it('stores a valid scope', async () => {
    const { setWidgetAnswerScope } = await import('@/lib/db/queries/widgets')
    await setWidgetAnswerScope(5, 'knowledge-base-only')
    expect(db.state.setValues).toEqual([{ widgetAnswerScope: 'knowledge-base-only' }])
  })

  it('refuses an unknown scope without writing', async () => {
    const { setWidgetAnswerScope } = await import('@/lib/db/queries/widgets')
    await expect(setWidgetAnswerScope(5, 'anything-goes')).rejects.toThrow('Invalid widget answer scope')
    expect(db.state.setValues).toEqual([])
  })
})

describe('setWidgetGuidance', () => {
  it('stores the cleaned note', async () => {
    const { setWidgetGuidance } = await import('@/lib/db/queries/widgets')
    await setWidgetGuidance(5, '  Be warm.\r\n\r\n\r\nBe brief.  ')
    expect(db.state.setValues).toEqual([{ widgetGuidance: 'Be warm.\n\nBe brief.' }])
  })

  it('clears the note with an empty string or null', async () => {
    const { setWidgetGuidance } = await import('@/lib/db/queries/widgets')
    await setWidgetGuidance(5, '   ')
    await setWidgetGuidance(5, null)
    expect(db.state.setValues).toEqual([{ widgetGuidance: null }, { widgetGuidance: null }])
  })

  it('refuses an oversized note without writing', async () => {
    const { setWidgetGuidance } = await import('@/lib/db/queries/widgets')
    await expect(setWidgetGuidance(5, 'x'.repeat(601))).rejects.toThrow('Keep guidance under 600 characters')
    expect(db.state.setValues).toEqual([])
  })
})

describe('getWidgetAnswerSettings', () => {
  it('returns what is stored', async () => {
    db.state.selectRows = [{ scope: 'general', guidance: 'Be warm.' }]
    const { getWidgetAnswerSettings } = await import('@/lib/db/queries/widgets')
    expect(await getWidgetAnswerSettings(5)).toEqual({ answerScope: 'general', guidance: 'Be warm.' })
  })

  it('reads an unrecognised scope as the narrower one', async () => {
    db.state.selectRows = [{ scope: 'wide-open', guidance: null }]
    const { getWidgetAnswerSettings } = await import('@/lib/db/queries/widgets')
    expect((await getWidgetAnswerSettings(5)).answerScope).toBe('knowledge-base-only')
  })

  it('reads a missing workspace as the narrower scope with no guidance', async () => {
    db.state.selectRows = []
    const { getWidgetAnswerSettings } = await import('@/lib/db/queries/widgets')
    expect(await getWidgetAnswerSettings(5)).toEqual({ answerScope: 'knowledge-base-only', guidance: null })
  })

  it('treats a stored note that no longer passes the limit as none', async () => {
    db.state.selectRows = [{ scope: 'general', guidance: 'x'.repeat(5000) }]
    const { getWidgetAnswerSettings } = await import('@/lib/db/queries/widgets')
    expect((await getWidgetAnswerSettings(5)).guidance).toBeNull()
  })
})

describe('the widget org the chat route reads', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 7,
    name: 'Acme',
    widget_token: 'tok',
    widget_token_expires_at: null,
    widget_allowed_origins: null,
    widget_lead_capture_mode: 'on-failure',
    widget_answer_scope: 'knowledge-base-only',
    widget_guidance: 'Be warm.',
    plan_id: 'pro',
    ...overrides,
  })

  it('carries the scope and the note', async () => {
    db.state.selectRows = [row()]
    const { getOrgByWidgetToken } = await import('@/lib/db/queries/widgets')
    const org = await getOrgByWidgetToken('tok')
    expect(org?.widget_answer_scope).toBe('knowledge-base-only')
    expect(org?.widget_guidance).toBe('Be warm.')
  })

  it('falls back to the narrower scope when the column comes back null or missing', async () => {
    const { getOrgByWidgetToken } = await import('@/lib/db/queries/widgets')
    for (const missing of [null, undefined]) {
      db.state.selectRows = [row({ widget_answer_scope: missing, widget_guidance: missing })]
      const org = await getOrgByWidgetToken('tok')
      expect(org?.widget_answer_scope, String(missing)).toBe('knowledge-base-only')
      expect(org?.widget_guidance, String(missing)).toBeNull()
    }
  })

  it('falls back to the narrower scope for a stored value it does not recognise', async () => {
    db.state.selectRows = [row({ widget_answer_scope: 'open' })]
    const { getOrgByWidgetToken } = await import('@/lib/db/queries/widgets')
    expect((await getOrgByWidgetToken('tok'))?.widget_answer_scope).toBe('knowledge-base-only')
  })

  it('never lets an oversized stored note into the instructions', async () => {
    db.state.selectRows = [row({ widget_guidance: 'x'.repeat(5000) })]
    const { getOrgByWidgetToken } = await import('@/lib/db/queries/widgets')
    expect((await getOrgByWidgetToken('tok'))?.widget_guidance).toBeNull()
  })
})
