import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

/**
 * lib/db/queries/kb-review.ts driven through drizzle's pg-proxy driver: real
 * compiled SQL, scripted rows, no database. Pins the outcome of each helper
 * and the org scoping on the compiled statements.
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
  // The proxy driver has no transactions; run the callback against the same
  // scripted connection and record BEGIN/COMMIT markers so tests can see them.
  const db = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ sql: 'begin', params: [], method: 'tx' })
      const out = await fn(fakeDb)
      calls.push({ sql: 'commit', params: [], method: 'tx' })
      return out
    },
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
}

const isSelectFrom = (c: Call) => c.sql.startsWith('select')
const isUpdate = (c: Call) => c.sql.startsWith('update')
const isInsert = (c: Call) => c.sql.startsWith('insert')

beforeEach(() => {
  calls = []
  respond = () => []
  install()
})

const input = (over: Record<string, unknown> = {}) => ({
  source: 'widget' as const,
  question: 'q?',
  answer: 'a',
  embedding: [0.1, 0.2],
  ...over,
})

describe('recordReviewItem', () => {
  it("returns 'exists' without touching anything else when the ticket was already captured", async () => {
    respond = (c) => (isSelectFrom(c) ? [[11]] : [])
    const { recordReviewItem } = await import('@/lib/db/queries/kb-review')
    const out = await recordReviewItem(input({ source: 'ticket', ticketId: 42 }), 3)
    expect(out).toBe('exists')
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toContain(42)
    expect(calls[0].params).toContain(3)
  })

  it('skips the ticket check entirely when there is no ticket id', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : [])
    const { recordReviewItem } = await import('@/lib/db/queries/kb-review')
    await recordReviewItem(input(), 3)
    expect(calls.some((c) => c.sql.includes('"ticket_id" = $'))).toBe(false)
  })

  it("returns 'merged' and bumps occurrences on the matched row, scoped to the org", async () => {
    respond = (c) => (isSelectFrom(c) && c.sql.includes('<=') ? [[99]] : [])
    const { recordReviewItem } = await import('@/lib/db/queries/kb-review')
    const out = await recordReviewItem(input(), 3)
    expect(out).toBe('merged')
    const dup = calls.find((c) => c.sql.includes('<='))!
    expect(dup.sql).toContain('"org_id"')
    expect(dup.sql).toContain('"embedding_vec" is not null')
    // pending and rejected fold in; approved gaps are already answered
    expect(dup.params).toEqual(expect.arrayContaining([3, 'pending', 'rejected']))
    expect(dup.params).not.toContain('approved')
    const upd = calls.find(isUpdate)!
    expect(upd.sql).toContain('occurrences = occurrences + 1')
    expect(upd.params).toEqual(expect.arrayContaining([99, 3]))
    expect(calls.some(isInsert)).toBe(false)
  })

  it('caps the per-day occurrence increments in the same statement that bumps the count', async () => {
    respond = (c) => (isSelectFrom(c) && c.sql.includes('<=') ? [[99]] : [])
    const { recordReviewItem, MAX_DAILY_OCCURRENCE_INCREMENTS } = await import('@/lib/db/queries/kb-review')
    await recordReviewItem(input(), 3)
    const upd = calls.find(isUpdate)!
    expect(upd.sql).toContain('merge_day_count < $')
    expect(upd.sql).toContain('merge_day is distinct from')
    expect(upd.params).toContain(MAX_DAILY_OCCURRENCE_INCREMENTS)
  })

  it("a duplicate still merges when the queue is full (merge is checked before the ceiling)", async () => {
    respond = (c) => (isSelectFrom(c) && c.sql.includes('<=') ? [[7]] : isSelectFrom(c) ? [[500]] : [])
    const { recordReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await recordReviewItem(input(), 3)).toBe('merged')
  })

  it("returns 'created' from one guarded INSERT ... SELECT run under a per-org advisory lock", async () => {
    respond = (c) => (c.sql.startsWith('insert into kb_review_items') ? [[1]] : [])
    const { MAX_PENDING_REVIEW_ITEMS, recordReviewItem } = await import('@/lib/db/queries/kb-review')
    const out = await recordReviewItem(input({ source: 'ticket', ticketId: 8, confidence: 0.4 }), 3)
    expect(out).toBe('created')
    const ins = calls.find((c) => c.sql.startsWith('insert into kb_review_items'))!
    expect(ins.sql).toContain('select count(*) from kb_review_items')
    expect(ins.sql).toContain('returning id')
    expect(ins.params).toEqual(expect.arrayContaining([3, 'ticket', 8, 'q?', 'a', 0.4, MAX_PENDING_REVIEW_ITEMS]))
    const names = calls.map((c) => c.sql)
    const lock = names.findIndex((q) => q.includes('pg_advisory_xact_lock'))
    expect(lock).toBeGreaterThan(names.indexOf('begin'))
    expect(lock).toBeLessThan(names.indexOf(ins.sql))
  })

  it("returns 'full' when the guarded insert adds no row", async () => {
    respond = () => []
    const { recordReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await recordReviewItem(input(), 3)).toBe('full')
  })

  it('stores a null ticket id and confidence for a widget question', async () => {
    respond = (c) => (c.sql.startsWith('insert into kb_review_items') ? [[1]] : [])
    const { recordReviewItem } = await import('@/lib/db/queries/kb-review')
    await recordReviewItem(input(), 3)
    const ins = calls.find((c) => c.sql.startsWith('insert into kb_review_items'))!
    expect(ins.params).toContain(null)
    expect(ins.params).toContain('widget')
  })

  it('exposes the duplicate threshold and queue ceiling the capture path relies on', async () => {
    const m = await import('@/lib/db/queries/kb-review')
    expect(m.REVIEW_DUPLICATE_SIMILARITY).toBe(0.85)
    expect(m.MAX_PENDING_REVIEW_ITEMS).toBe(500)
  })
})

describe('approveReviewItem', () => {
  const approve = () => ({
    id: 5,
    question: 'edited q',
    answer: 'edited a',
    embedding: [0.1],
    model: 'embed-model',
    reviewedBy: 12,
    cap: 2000,
  })

  it('claims a pending item, publishes the edited text as an article and links it', async () => {
    respond = (c) => {
      if (isUpdate(c) && c.sql.includes('returning')) return [[5]]
      if (isInsert(c)) return [[321]]
      return []
    }
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    const out = await approveReviewItem(approve(), 3)
    expect(out).toEqual({ ok: true, articleId: 321 })

    const claim = calls.find((c) => isUpdate(c) && c.sql.includes('returning'))!
    expect(claim.params).toEqual(expect.arrayContaining(['approved', 'edited q', 'edited a', 12, 5, 3, 'pending']))
    const article = calls.find((c) => c.sql.startsWith('insert into "kb_articles"'))!
    expect(article.params).toEqual(expect.arrayContaining([3, 'edited q', 'edited a', 'embed-model']))
    const link = calls.filter(isUpdate).at(-1)!
    expect(link.params).toContain(321)
    expect(calls.map((c) => c.sql.split(' ')[0])).toEqual(expect.arrayContaining(['begin', 'commit']))
  })

  it("reports 'not_pending' and creates no article when the item exists but was already resolved", async () => {
    respond = (c) => (isUpdate(c) ? [] : isSelectFrom(c) ? [[5]] : [])
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    const out = await approveReviewItem(approve(), 3)
    expect(out).toEqual({ ok: false, reason: 'not_pending' })
    expect(calls.some(isInsert)).toBe(false)
  })

  it("reports 'not_found' for an id that does not exist in this org", async () => {
    respond = () => []
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    const out = await approveReviewItem(approve(), 3)
    expect(out).toEqual({ ok: false, reason: 'not_found' })
    expect(calls.some(isInsert)).toBe(false)
    // the existence probe is org-scoped too, so another org's id reads as not_found
    const probe = calls.find(isSelectFrom)!
    expect(probe.params).toEqual(expect.arrayContaining([5, 3]))
  })
})

describe('approveReviewItem with an article limit', () => {
  const withCap = (cap: number) => ({
    id: 5,
    question: 'edited q',
    answer: 'edited a',
    embedding: [0.1],
    model: 'embed-model',
    reviewedBy: 12,
    cap,
  })
  const scripted = (articleCount: number) => (c: Call) => {
    if (c.sql.includes('count(*)')) return [[articleCount]]
    if (isUpdate(c) && c.sql.includes('returning')) return [[5]]
    if (isInsert(c)) return [[321]]
    return []
  }
  const names = () => calls.map((c) => c.sql)

  it('claims the item, takes the org lock, counts, then inserts, in that order', async () => {
    respond = scripted(10)
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await approveReviewItem(withCap(2000), 3)).toEqual({ ok: true, articleId: 321 })
    const claim = names().findIndex((q) => q.startsWith('update') && q.includes('returning'))
    const lock = names().findIndex((q) => q.includes('pg_advisory_xact_lock'))
    const count = names().findIndex((q) => q.includes('count(*)'))
    const insert = names().findIndex((q) => q.startsWith('insert into "kb_articles"'))
    expect(claim).toBeGreaterThan(names().indexOf('begin'))
    expect(lock).toBeGreaterThan(claim)
    expect(count).toBeGreaterThan(lock)
    expect(insert).toBeGreaterThan(count)
    expect(calls.find((c) => c.sql.includes('count(*)'))!.params).toContain(3)
  })

  it('publishes when exactly one slot is left', async () => {
    respond = scripted(1999)
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await approveReviewItem(withCap(2000), 3)).toEqual({ ok: true, articleId: 321 })
  })

  it.each([2000, 2400])('refuses with ArticleCapReachedError at %i articles, inserting nothing and never committing', async (n) => {
    respond = scripted(n)
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    const { ArticleCapReachedError } = await import('@/lib/db/queries/kb-article-cap')
    await expect(approveReviewItem(withCap(2000), 3)).rejects.toBeInstanceOf(ArticleCapReachedError)
    expect(calls.some(isInsert)).toBe(false)
    // the claim ran inside the transaction that never committed, so the item stays pending
    expect(names()).toContain('begin')
    expect(names()).not.toContain('commit')
    // exactly one update: the claim. Nothing links an article to the item.
    expect(calls.filter(isUpdate)).toHaveLength(1)
  })

  it('does not check the limit for an item that is no longer pending', async () => {
    respond = (c) => (isUpdate(c) ? [] : isSelectFrom(c) && !c.sql.includes('count(*)') ? [[5]] : [])
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await approveReviewItem(withCap(2000), 3)).toEqual({ ok: false, reason: 'not_pending' })
    expect(names().some((q) => q.includes('pg_advisory_xact_lock'))).toBe(false)
  })
})

describe('rejectReviewItem / reopenReviewItem', () => {
  it('reject moves pending to rejected and records the reviewer', async () => {
    respond = (c) => (isUpdate(c) ? [[5]] : [])
    const { rejectReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await rejectReviewItem(5, 3, 12)).toEqual({ ok: true })
    const upd = calls[0]
    expect(upd.params).toEqual(expect.arrayContaining(['rejected', 12, 5, 3, 'pending']))
  })

  it('reopen moves rejected back to pending and clears the reviewer', async () => {
    respond = (c) => (isUpdate(c) ? [[5]] : [])
    const { reopenReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await reopenReviewItem(5, 3, 12)).toEqual({ ok: true })
    const upd = calls[0]
    expect(upd.params).toEqual(expect.arrayContaining(['pending', 5, 3, 'rejected']))
    expect(upd.params).not.toContain(12)
    expect(upd.params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2)
  })

  it("answers 'not_pending' when the row exists in another state, 'not_found' when it does not", async () => {
    const { rejectReviewItem } = await import('@/lib/db/queries/kb-review')
    respond = (c) => (isSelectFrom(c) ? [[5]] : [])
    expect(await rejectReviewItem(5, 3, 12)).toEqual({ ok: false, reason: 'not_pending' })
    respond = () => []
    expect(await rejectReviewItem(5, 3, 12)).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('reads', () => {
  it('countReviewItems folds grouped rows into zero-filled counts and ignores unknown statuses', async () => {
    respond = () => [['pending', 4], ['rejected', 2], ['weird', 9]]
    const { countReviewItems } = await import('@/lib/db/queries/kb-review')
    expect(await countReviewItems(3)).toEqual({ pending: 4, approved: 0, rejected: 2 })
    expect(calls[0].params).toContain(3)
  })

  it('listReviewItems scopes by org and status and orders most-asked first', async () => {
    respond = () => []
    const { listReviewItems } = await import('@/lib/db/queries/kb-review')
    expect(await listReviewItems(3, 'pending', 25)).toEqual([])
    expect(calls[0].params).toEqual(expect.arrayContaining([3, 'pending', 25]))
    expect(calls[0].sql).toMatch(/order by "kb_review_items"\."occurrences" desc, "kb_review_items"\."created_at" desc/)
  })

  it('getReviewItem returns null when no row matches the id within the org', async () => {
    respond = () => []
    const { getReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await getReviewItem(5, 3)).toBeNull()
    expect(calls[0].params).toEqual(expect.arrayContaining([5, 3]))
  })
})

describe('purgeExpiredReviewText', () => {
  it('clears text of rejected items and of approved items past the retention window', async () => {
    respond = (c) => (isUpdate(c) ? [[1], [2], [3]] : [])
    const { purgeExpiredReviewText, REVIEW_TEXT_RETENTION_DAYS } = await import('@/lib/db/queries/kb-review')
    const now = new Date('2026-10-01T00:00:00.000Z')
    expect(await purgeExpiredReviewText(now)).toBe(3)
    const upd = calls.find(isUpdate)!
    expect(upd.sql).toContain('"question" = $')
    expect(upd.params).toEqual(expect.arrayContaining(['', 'rejected', 'approved']))
    const cutoff = new Date(now.getTime() - REVIEW_TEXT_RETENTION_DAYS * 86_400_000).toISOString()
    expect(upd.params).toContain(cutoff)
    // idempotent: only rows that still hold text are touched
    expect(upd.sql).toContain(`"question" <> ''`)
  })
})
