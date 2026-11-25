import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

/**
 * lib/db/queries/widget-answer-flags.ts driven through drizzle's pg-proxy
 * driver: real compiled SQL, scripted rows, no database. Pins the outcome of
 * each helper, the workspace scoping on every statement, and the rules about
 * what text is kept.
 */

type Call = { sql: string; params: unknown[]; method: string }

let calls: Call[]
let respond: (c: Call) => unknown[][]

function install() {
  const fakeDb = drizzle(async (sqlText: string, params: unknown[], method: 'all' | 'execute' | 'get' | 'values' | 'run') => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params, method }
    calls.push(call)
    return { rows: respond(call) }
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
  vi.resetModules()
}

const isInsert = (c: Call) => c.sql.startsWith('insert')
const isUpdate = (c: Call) => c.sql.startsWith('update')

const ANSWER_ID = '3f0c2b9e-5d1a-4c7e-9a43-0b6d8e2f1a77'

beforeEach(() => {
  calls = []
  respond = () => []
  install()
})

const input = (over: Record<string, unknown> = {}) => ({
  orgId: 7,
  answerId: ANSWER_ID,
  verdict: 'down' as const,
  question: 'how do I export?',
  answer: 'Use Settings > Export.',
  ...over,
})

// Scripts the statements createAnswerFlag makes, in order: the answer check,
// the existing-flag check, today's count, the cited references, then the upsert.
function script(over: { answer?: unknown[][]; existing?: unknown[][]; today?: unknown[][]; refs?: unknown[][]; upsert?: unknown[][] }) {
  const queue = [
    over.answer ?? [[ANSWER_ID]],
    over.existing ?? [],
    over.today ?? [[0]],
    over.refs ?? [[4], [9]],
    over.upsert ?? [[21]],
  ]
  respond = (c) => {
    if (isInsert(c)) return queue[4]
    if (c.sql.includes('from "kb_answers"')) return queue[0]
    if (c.sql.includes('count(*)')) return queue[2]
    if (c.sql.includes('from "kb_answer_references"')) return queue[3]
    if (c.sql.includes('from "widget_answer_flags"')) return queue[1]
    return []
  }
}

describe('createAnswerFlag', () => {
  it('refuses an id that is not a uuid without touching the database', async () => {
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await createAnswerFlag(input({ answerId: 'nope' }))).toEqual({ ok: false, reason: 'no_answer' })
    expect(calls).toHaveLength(0)
  })

  it('refuses an answer that is not a generated widget answer in this workspace, writing nothing', async () => {
    script({ answer: [] })
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await createAnswerFlag(input())).toEqual({ ok: false, reason: 'no_answer' })
    const lookup = calls[0]
    expect(lookup.sql).toContain('"org_id"')
    expect(lookup.sql).toContain('"surface"')
    expect(lookup.sql).toContain('"outcome"')
    expect(lookup.params).toEqual(expect.arrayContaining([ANSWER_ID, 7, 'widget', 'generated']))
    expect(calls.some(isInsert)).toBe(false)
  })

  it('creates a flag, copying the cited articles from the server record in rank order', async () => {
    script({})
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    const out = await createAnswerFlag(input())
    expect(out).toEqual({ ok: true, id: 21, created: true })
    const refs = calls.find((c) => c.sql.includes('from "kb_answer_references"'))!
    expect(refs.sql).toContain('order by')
    const insert = calls.find(isInsert)!
    expect(insert.sql).toContain('on conflict ("answer_id") where')
    expect(insert.params).toEqual(expect.arrayContaining([7, ANSWER_ID, 'down', 'how do I export?', 'Use Settings > Export.']))
  })

  it('stores no question or answer text for a thumbs-up', async () => {
    script({})
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    await createAnswerFlag(input({ verdict: 'up' }))
    const insert = calls.find(isInsert)!
    expect(insert.params).toContain('up')
    expect(insert.params).not.toContain('how do I export?')
    expect(insert.params).not.toContain('Use Settings > Export.')
  })

  it('only updates a still-open flag whose verdict changes when one already exists', async () => {
    script({ existing: [[21]], upsert: [] })
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    const out = await createAnswerFlag(input())
    expect(out).toEqual({ ok: true, id: 21, created: false })
    const insert = calls.find(isInsert)!
    expect(insert.sql).toContain('do update set')
    expect(insert.sql).toMatch(/where .*"status" = \$\d+ and .*"verdict" <> \$\d+/)
  })

  it('does not count against the daily ceiling when the flag already exists', async () => {
    script({ existing: [[21]], upsert: [] })
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    await createAnswerFlag(input())
    expect(calls.some((c) => c.sql.includes('count(*)'))).toBe(false)
  })

  it('refuses a new flag once the workspace has reached its daily ceiling', async () => {
    script({ today: [[200]] })
    const { createAnswerFlag, MAX_FLAGS_PER_DAY } = await import('@/lib/db/queries/widget-answer-flags')
    expect(MAX_FLAGS_PER_DAY).toBe(200)
    expect(await createAnswerFlag(input())).toEqual({ ok: false, reason: 'limit' })
    expect(calls.some(isInsert)).toBe(false)
  })

  it('returns the flag a concurrent call created in between', async () => {
    let seen = 0
    respond = (c) => {
      if (isInsert(c)) return []
      if (c.sql.includes('from "kb_answers"')) return [[ANSWER_ID]]
      if (c.sql.includes('count(*)')) return [[0]]
      if (c.sql.includes('from "kb_answer_references"')) return []
      if (c.sql.includes('from "widget_answer_flags"')) return ++seen === 1 ? [] : [[33]]
      return []
    }
    const { createAnswerFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await createAnswerFlag(input())).toEqual({ ok: true, id: 33, created: false })
  })
})

describe('updateFlagDetails', () => {
  it('scopes to the workspace and changes only what was provided', async () => {
    respond = () => [[11]]
    const { updateFlagDetails } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await updateFlagDetails({ id: 11, orgId: 7, reason: 'outdated' })).toBe(true)
    const up = calls.find(isUpdate)!
    expect(up.sql).toContain('"reason"')
    expect(up.sql).not.toContain('"note"')
    expect(up.sql).not.toContain('"lead_id"')
    expect(up.params).toEqual(expect.arrayContaining([11, 7, 'outdated']))
  })

  it('reports false when there is no such flag in the workspace', async () => {
    const { updateFlagDetails } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await updateFlagDetails({ id: 11, orgId: 8, note: 'x' })).toBe(false)
  })
})

describe('getDownFlag', () => {
  it('only finds a thumbs-down in the given workspace', async () => {
    respond = () => [[11, 'how do I export?']]
    const { getDownFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await getDownFlag(11, 7)).toEqual({ id: 11, question: 'how do I export?' })
    expect(calls[0].params).toEqual(expect.arrayContaining([11, 7, 'down']))
  })

  it('returns null when nothing matches', async () => {
    const { getDownFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await getDownFlag(11, 7)).toBeNull()
  })
})

describe('transitions', () => {
  it('resolve claims only an open flag, in this workspace, recording who acted', async () => {
    respond = () => [[11]]
    const { resolveFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await resolveFlag(11, 7, 3)).toEqual({ ok: true })
    const up = calls.find(isUpdate)!
    expect(up.params).toEqual(expect.arrayContaining([11, 7, 3, 'resolved', 'open']))
  })

  it("dismiss clears the visitor's text at once", async () => {
    respond = () => [[11]]
    const { dismissFlag } = await import('@/lib/db/queries/widget-answer-flags')
    await dismissFlag(11, 7, 3)
    const up = calls.find(isUpdate)!
    expect(up.sql).toContain('"question"')
    expect(up.sql).toContain('"answer"')
    expect(up.sql).toContain('"note"')
    expect(up.params).toEqual(expect.arrayContaining(['dismissed', '']))
  })

  it('reopen clears who resolved it', async () => {
    respond = () => [[11]]
    const { reopenFlag } = await import('@/lib/db/queries/widget-answer-flags')
    await reopenFlag(11, 7, 3)
    const up = calls.find(isUpdate)!
    expect(up.params).toEqual(expect.arrayContaining(['open', 'resolved', 'dismissed']))
    expect(up.params).not.toContain(3)
  })

  it("says 'wrong_state' when the flag exists but is not in a state that allows it", async () => {
    respond = (c) => (isUpdate(c) ? [] : [[11]])
    const { resolveFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await resolveFlag(11, 7, 3)).toEqual({ ok: false, reason: 'wrong_state' })
  })

  it("says 'not_found' when there is no such flag in the workspace", async () => {
    respond = () => []
    const { resolveFlag } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await resolveFlag(11, 7, 3)).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('listFlags and countFlags', () => {
  it('lists only thumbs-downs in the status and workspace, newest first, with cited articles that still exist', async () => {
    respond = (c) => {
      if (c.sql.includes('from "kb_articles"')) return [[4, 'How do I export?']]
      return [
        [11, 7, ANSWER_ID, 'down', 'outdated', 'old', 'q', 'a', [4, 9], 5, 'open', null, null, '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z'],
      ]
    }
    const { listFlags } = await import('@/lib/db/queries/widget-answer-flags')
    const out = await listFlags(7, 'open')
    expect(out).toHaveLength(1)
    // Article 9 was deleted since: it is simply left out.
    expect(out[0].cited_articles).toEqual([{ id: 4, question: 'How do I export?' }])
    expect(out[0].lead_id).toBe(5)
    const select = calls[0]
    expect(select.sql).toContain('order by')
    expect(select.params).toEqual(expect.arrayContaining([7, 'open', 'down']))
    const articles = calls[1]
    expect(articles.params).toContain(7)
  })

  it('returns an empty list without a second query when there are no flags', async () => {
    const { listFlags } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await listFlags(7, 'open')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('counts thumbs-downs per status', async () => {
    respond = () => [
      ['open', 3],
      ['dismissed', 1],
    ]
    const { countFlags } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await countFlags(7)).toEqual({ open: 3, resolved: 0, dismissed: 1 })
    expect(calls[0].params).toEqual(expect.arrayContaining([7, 'down']))
  })
})

describe('listFlagsForLeads', () => {
  it('reads only thumbs-down flags that have a lead, in this workspace, oldest first', async () => {
    respond = () => []
    const { listFlagsForLeads } = await import('@/lib/db/queries/widget-answer-flags')
    expect(await listFlagsForLeads(7)).toEqual(new Map())
    const select = calls[0]
    expect(select.params).toEqual(expect.arrayContaining([7, 'down']))
    expect(select.sql).toContain('"lead_id" is not null')
    expect(select.sql).toMatch(/order by "widget_answer_flags"\."created_at" asc/)
    // The visitor's note is never read for this list.
    expect(select.sql).not.toContain('"note"')
  })

  it('maps each lead to its flag, and the newest flag wins where one lead flagged several answers', async () => {
    respond = () => [
      [10, 5, 'outdated', 'older q', 'older a'],
      [11, 6, null, 'q6', 'a6'],
      [12, 5, 'wrong_information', 'newer q', 'newer a'],
    ]
    const { listFlagsForLeads } = await import('@/lib/db/queries/widget-answer-flags')
    const out = await listFlagsForLeads(7)
    expect([...out.keys()]).toEqual([5, 6])
    expect(out.get(5)).toEqual({ flag_id: 12, lead_id: 5, reason: 'wrong_information', question: 'newer q', answer: 'newer a' })
    expect(out.get(6)).toEqual({ flag_id: 11, lead_id: 6, reason: null, question: 'q6', answer: 'a6' })
  })
})

describe('purgeExpiredFlagText', () => {
  it('clears text on dismissed flags and on flags older than the retention window, and counts the rows', async () => {
    respond = () => [[1], [2], [3]]
    const { purgeExpiredFlagText, FLAG_TEXT_RETENTION_DAYS } = await import('@/lib/db/queries/widget-answer-flags')
    expect(FLAG_TEXT_RETENTION_DAYS).toBe(90)
    const now = new Date('2026-11-22T00:00:00Z')
    expect(await purgeExpiredFlagText(now)).toBe(3)
    const up = calls.find(isUpdate)!
    expect(up.params).toContain('dismissed')
    expect(up.params).toContain('2026-08-24T00:00:00.000Z')
    // Rows, reasons and cited articles stay: only the three text columns are set.
    expect(up.sql).toContain('"question"')
    expect(up.sql).toContain('"answer"')
    expect(up.sql).toContain('"note"')
    expect(up.sql).not.toContain('"reason" =')
    expect(up.sql).not.toContain('delete')
  })
})
