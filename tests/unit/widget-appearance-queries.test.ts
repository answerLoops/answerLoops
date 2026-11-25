import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * getWidgetAppearance and setWidgetAppearance in lib/db/queries/widgets.ts. The
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

describe('setWidgetAppearance', () => {
  it('stores the cleaned values and returns exactly what was stored', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    const stored = await setWidgetAppearance(5, { title: '  Acme   Help  ', welcome: ' Hi! ', brandColor: '#FFD60A' })
    expect(db.state.setValues).toEqual([
      { widgetTitle: 'Acme Help', widgetWelcome: 'Hi!', widgetBrandColor: '#ffd60a', widgetStarterQuestions: null, widgetStarterEnabled: null, widgetFollowUpsEnabled: null },
    ])
    expect(stored).toEqual({ title: 'Acme Help', welcome: 'Hi!', brandColor: '#ffd60a', starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
  })

  it('stores starter questions cleaned, one per line, and returns them as a list', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    const stored = await setWidgetAppearance(5, {
      title: null,
      welcome: null,
      brandColor: null,
      starterQuestions: ' How does it work? \n\nWhat does it cost?\nhow does it work?',
    })
    expect(db.state.setValues).toEqual([
      {
        widgetTitle: null,
        widgetWelcome: null,
        widgetBrandColor: null,
        widgetStarterQuestions: 'How does it work?\nWhat does it cost?',
        widgetStarterEnabled: null,
        widgetFollowUpsEnabled: null,
      },
    ])
    expect(stored.starterQuestions).toEqual(['How does it work?', 'What does it cost?'])
  })

  it('stores the switch as false only when off, and keeps the questions', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    const stored = await setWidgetAppearance(5, {
      title: null,
      welcome: null,
      brandColor: null,
      starterQuestions: 'How does it work?',
      starterEnabled: false,
      followUpsEnabled: true,
    })
    expect(db.state.setValues[0]).toMatchObject({
      widgetStarterQuestions: 'How does it work?',
      widgetStarterEnabled: false,
      widgetFollowUpsEnabled: null,
    })
    expect(stored).toMatchObject({ starterQuestions: ['How does it work?'], starterEnabled: false, followUpsEnabled: true })
  })

  it('stores the follow-up suggestions switch as false only when off, leaving the rest alone', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    const off = await setWidgetAppearance(5, { title: null, welcome: null, brandColor: null, followUpsEnabled: false })
    expect(db.state.setValues[0]).toMatchObject({ widgetFollowUpsEnabled: false, widgetStarterEnabled: null })
    expect(off.followUpsEnabled).toBe(false)
    const on = await setWidgetAppearance(5, { title: null, welcome: null, brandColor: null, followUpsEnabled: true })
    expect(db.state.setValues[1]).toMatchObject({ widgetFollowUpsEnabled: null })
    expect(on.followUpsEnabled).toBe(true)
    const unset = await setWidgetAppearance(5, { title: null, welcome: null, brandColor: null })
    expect(unset.followUpsEnabled).toBe(true)
  })

  it('refuses too many or too long starter questions without writing', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    const base = { title: null, welcome: null, brandColor: null }
    await expect(setWidgetAppearance(5, { ...base, starterQuestions: 'a\nb\nc\nd\ne' })).rejects.toThrow(
      'Use up to 4 starter questions, 80 characters each.'
    )
    await expect(setWidgetAppearance(5, { ...base, starterQuestions: 'q'.repeat(81) })).rejects.toThrow(
      'Use up to 4 starter questions, 80 characters each.'
    )
    expect(db.state.setValues).toEqual([])
  })

  it('clears everything when the values are empty or null', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    await setWidgetAppearance(5, { title: '   ', welcome: '', brandColor: null })
    expect(db.state.setValues).toEqual([
      {
        widgetTitle: null,
        widgetWelcome: null,
        widgetBrandColor: null,
        widgetStarterQuestions: null,
        widgetStarterEnabled: null,
        widgetFollowUpsEnabled: null,
      },
    ])
  })

  it('refuses an oversized title, an oversized welcome and a bad color without writing', async () => {
    const { setWidgetAppearance } = await import('@/lib/db/queries/widgets')
    await expect(setWidgetAppearance(5, { title: 't'.repeat(61), welcome: null, brandColor: null })).rejects.toThrow(
      'Keep the chat title under 60 characters'
    )
    await expect(setWidgetAppearance(5, { title: null, welcome: 'w'.repeat(201), brandColor: null })).rejects.toThrow(
      'Keep the welcome message under 200 characters'
    )
    for (const bad of ['red', '#fff', 'url(javascript:alert(1))', '#12345g']) {
      await expect(setWidgetAppearance(5, { title: null, welcome: null, brandColor: bad })).rejects.toThrow(
        'Choose a color like #1a73e8.'
      )
    }
    expect(db.state.setValues).toEqual([])
  })
})

describe('getWidgetAppearance', () => {
  it('reads back what is stored', async () => {
    db.state.selectRows = [
      { title: 'Acme Help', welcome: 'Hi!', brandColor: '#ffd60a', starterQuestions: 'How does it work?\nWhat does it cost?' },
    ]
    const { getWidgetAppearance } = await import('@/lib/db/queries/widgets')
    expect(await getWidgetAppearance(5)).toEqual({
      title: 'Acme Help',
      welcome: 'Hi!',
      brandColor: '#ffd60a',
      starterQuestions: ['How does it work?', 'What does it cost?'],
      starterEnabled: true,
      followUpsEnabled: true,
    })
  })

  it('reads the switch: only an explicit false is off', async () => {
    const { getWidgetAppearance } = await import('@/lib/db/queries/widgets')
    db.state.selectRows = [{ title: null, welcome: null, brandColor: null, starterQuestions: 'Q', starterEnabled: false, followUpsEnabled: true }]
    expect(await getWidgetAppearance(5)).toMatchObject({ starterQuestions: ['Q'], starterEnabled: false, followUpsEnabled: true })
    db.state.selectRows = [{ title: null, welcome: null, brandColor: null, starterQuestions: null, starterEnabled: null, followUpsEnabled: false }]
    expect(await getWidgetAppearance(5)).toMatchObject({ followUpsEnabled: false })
    db.state.selectRows = [{ title: null, welcome: null, brandColor: null, starterQuestions: null, starterEnabled: null, followUpsEnabled: null }]
    expect(await getWidgetAppearance(5)).toMatchObject({ followUpsEnabled: true })
    db.state.selectRows = [{ title: null, welcome: null, brandColor: null, starterQuestions: 'Q', starterEnabled: null }]
    expect(await getWidgetAppearance(5)).toMatchObject({ starterEnabled: true, followUpsEnabled: true })
  })

  it('treats a workspace with nothing stored, or no row, as the answerLoops default', async () => {
    const { getWidgetAppearance } = await import('@/lib/db/queries/widgets')
    db.state.selectRows = [{ title: null, welcome: null, brandColor: null }]
    expect(await getWidgetAppearance(5)).toEqual({ title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
    db.state.selectRows = []
    expect(await getWidgetAppearance(5)).toEqual({ title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
  })

  it('discards a value written outside the setter that would not pass the checks', async () => {
    db.state.selectRows = [
      {
        title: 't'.repeat(500),
        welcome: 'ok',
        brandColor: 'red;}body{display:none',
        starterQuestions: 'fine\n' + 'x'.repeat(200) + '\na\nb\nc\nd\ne',
      },
    ]
    const { getWidgetAppearance } = await import('@/lib/db/queries/widgets')
    expect(await getWidgetAppearance(5)).toEqual({
      title: null,
      welcome: 'ok',
      brandColor: null,
      starterQuestions: ['fine', 'a', 'b', 'c'],
      starterEnabled: true,
      followUpsEnabled: true,
    })
  })
})
