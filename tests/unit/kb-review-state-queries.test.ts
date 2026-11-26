import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { contentHash } from '@/lib/kb/revision'
import { REVIEW_NOTE_MAX } from '@/lib/kb/review-state'

/**
 * Review-state changes (lib/db/queries/kb-review-state.ts), the automatic
 * needs-review flag on edits to verified articles (lib/db/queries/kb-events.ts),
 * verification clearing the flag, and retrieval leaving superseded articles out
 * (lib/db/queries/kb.ts). Driven through drizzle's pg-proxy driver, so every
 * statement is the real compiled SQL; rows are scripted per test.
 */

type Call = { sql: string; params: unknown[] }

let calls: Call[]
let respond: (c: Call) => unknown[][]

function install() {
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    return { rows: respond(call) }
  })
  const db = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ sql: 'begin', params: [] })
      const out = await fn(fakeDb)
      calls.push({ sql: 'commit', params: [] })
      return out
    },
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
}

beforeEach(() => {
  calls = []
  respond = () => []
  install()
})

const Q = 'How do I reset?'
const A = 'Use the link.'
const HASH = contentHash(Q, A)

/** The locked article read every transition starts with: id, question, answer, review_state. */
const lockedRead = (c: Call) => c.sql.startsWith('select "id", "question", "answer", "review_state"')
/** The replacement article check: published, review_state. */
const replacementRead = (c: Call) => c.sql.startsWith('select "published", "review_state"')

/** Scripts the article (and optionally a replacement) the transition finds. */
function article(state: string | null, replacement?: [number, string] | null) {
  respond = (c) => {
    if (lockedRead(c)) return state === null ? [] : [[7, Q, A, state]]
    if (replacementRead(c)) return replacement ? [replacement] : []
    return []
  }
}

const updates = () => calls.filter((c) => c.sql.startsWith('update "kb_articles"'))
const eventInserts = () => calls.filter((c) => c.sql.startsWith('insert into "kb_article_events"'))

/** Maps each column an UPDATE assigns to the value it receives. */
function assignments(c: Call): Record<string, unknown> {
  const set = c.sql.slice(c.sql.indexOf(' set ') + 5, c.sql.indexOf(' where '))
  return Object.fromEntries(
    set.split(', ').map((pair) => {
      const [col, val] = pair.split(' = ')
      const p = val.match(/^\$(\d+)$/)
      return [col.replace(/"/g, ''), p ? c.params[Number(p[1]) - 1] : val]
    })
  )
}

/** Maps each column of the compiled event INSERT to its value. */
function inserted(c: Call): Record<string, unknown> {
  const m = c.sql.match(/^insert into "kb_article_events" \((.*?)\) values \((.*?)\)$/)!
  const cols = m[1].split(', ').map((s) => s.replace(/"/g, ''))
  const vals = m[2].split(', ')
  return Object.fromEntries(
    cols.map((col, i) => {
      const p = vals[i].match(/^\$(\d+)$/)
      return [col, p ? c.params[Number(p[1]) - 1] : vals[i]]
    })
  )
}

describe('every transition', () => {
  it('locks the article row, scoped to the workspace, before deciding anything', async () => {
    article('current')
    const { flagArticleForReview } = await import('@/lib/db/queries/kb-review-state')
    await flagArticleForReview({ articleId: 7, userId: 12 }, 3)
    const read = calls.find(lockedRead)!
    expect(read.sql).toMatch(/ for update/)
    expect(read.sql).toContain('"org_id" = $')
    expect(read.params).toEqual(expect.arrayContaining([7, 3]))
    expect(calls[0].sql).toBe('begin')
    expect(calls[calls.length - 1].sql).toBe('commit')
  })

  it('treats another workspace’s article as not found and writes nothing', async () => {
    article(null)
    const { flagArticleForReview, supersedeArticle, restoreArticle, clearReviewFlag } = await import(
      '@/lib/db/queries/kb-review-state'
    )
    expect(await flagArticleForReview({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: false, reason: 'not_found' })
    expect(await clearReviewFlag({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: false, reason: 'not_found' })
    expect(await supersedeArticle({ articleId: 7, userId: 12, replacement: { url: 'https://x.test/' } }, 3)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await restoreArticle({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: false, reason: 'not_found' })
    expect(updates()).toHaveLength(0)
    expect(eventInserts()).toHaveLength(0)
  })
})

describe('flagArticleForReview', () => {
  it('moves a current article to needs_review with who, when and the trimmed reason, and records the event', async () => {
    article('current')
    const { flagArticleForReview } = await import('@/lib/db/queries/kb-review-state')
    expect(await flagArticleForReview({ articleId: 7, userId: 12, note: '  Pricing changed  ' }, 3)).toEqual({ ok: true })

    expect(updates()).toHaveLength(1)
    expect(assignments(updates()[0])).toMatchObject({
      review_state: 'needs_review',
      review_note: 'Pricing changed',
      review_state_by: 12,
      review_state_at: expect.any(String),
    })
    expect(eventInserts()).toHaveLength(1)
    expect(inserted(eventInserts()[0])).toMatchObject({
      org_id: 3,
      article_id: 7,
      type: 'flagged_for_review',
      actor_user_id: 12,
      origin: 'manual',
      content_hash: HASH,
    })
  })

  it('stores no reason when none is given, and cuts an over-long one to the limit', async () => {
    article('current')
    const { flagArticleForReview } = await import('@/lib/db/queries/kb-review-state')
    await flagArticleForReview({ articleId: 7, userId: 12, note: '   ' }, 3)
    expect(assignments(updates()[0]).review_note).toBeNull()

    calls = []
    await flagArticleForReview({ articleId: 7, userId: 12, note: 'x'.repeat(REVIEW_NOTE_MAX + 50) }, 3)
    expect(assignments(updates()[0]).review_note).toHaveLength(REVIEW_NOTE_MAX)
  })

  it.each(['needs_review', 'superseded'])('refuses an article already %s, writing nothing', async (state) => {
    article(state)
    const { flagArticleForReview } = await import('@/lib/db/queries/kb-review-state')
    expect(await flagArticleForReview({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: false, reason: 'wrong_state' })
    expect(updates()).toHaveLength(0)
    expect(eventInserts()).toHaveLength(0)
  })
})

describe('clearReviewFlag', () => {
  it('returns a flagged article to current and records the event', async () => {
    article('needs_review')
    const { clearReviewFlag } = await import('@/lib/db/queries/kb-review-state')
    expect(await clearReviewFlag({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: true })
    expect(assignments(updates()[0])).toMatchObject({ review_state: 'current', review_note: null, review_state_by: 12 })
    expect(inserted(eventInserts()[0])).toMatchObject({ type: 'review_flag_cleared', actor_user_id: 12, origin: 'manual' })
  })

  it.each(['current', 'superseded'])('refuses an article that is %s', async (state) => {
    article(state)
    const { clearReviewFlag } = await import('@/lib/db/queries/kb-review-state')
    expect(await clearReviewFlag({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: false, reason: 'wrong_state' })
    expect(updates()).toHaveLength(0)
  })
})

describe('supersedeArticle', () => {
  it.each(['current', 'needs_review'])('replaces a %s article with a link, clearing any article reference and reason', async (state) => {
    article(state)
    const { supersedeArticle } = await import('@/lib/db/queries/kb-review-state')
    const out = await supersedeArticle({ articleId: 7, userId: 12, replacement: { url: 'https://docs.example.com/a' } }, 3)
    expect(out).toEqual({ ok: true })
    expect(assignments(updates()[0])).toMatchObject({
      review_state: 'superseded',
      superseded_by_url: 'https://docs.example.com/a',
      superseded_by_article_id: null,
      review_note: null,
      review_state_by: 12,
    })
    expect(inserted(eventInserts()[0])).toMatchObject({ type: 'superseded', actor_user_id: 12, origin: 'manual', content_hash: HASH })
  })

  it('replaces an article with another published article in the same workspace, locking the replacement', async () => {
    article('current', [1, 'current'])
    const { supersedeArticle } = await import('@/lib/db/queries/kb-review-state')
    expect(await supersedeArticle({ articleId: 7, userId: 12, replacement: { articleId: 8 } }, 3)).toEqual({ ok: true })

    const check = calls.find(replacementRead)!
    expect(check.sql).toMatch(/ for share/)
    expect(check.sql).toContain('"org_id" = $')
    expect(check.params).toEqual(expect.arrayContaining([8, 3]))
    expect(assignments(updates()[0])).toMatchObject({
      review_state: 'superseded',
      superseded_by_article_id: 8,
      superseded_by_url: null,
    })
  })

  it.each([
    ['itself', { articleId: 7 }, [1, 'current']],
    ['an article in no workspace it can see', { articleId: 8 }, null],
    ['an unpublished article', { articleId: 8 }, [0, 'current']],
    ['an article that is superseded itself', { articleId: 8 }, [1, 'superseded']],
  ] as const)('refuses %s as the replacement, writing nothing', async (_label, replacement, found) => {
    article('current', found as [number, string] | null)
    const { supersedeArticle } = await import('@/lib/db/queries/kb-review-state')
    expect(await supersedeArticle({ articleId: 7, userId: 12, replacement }, 3)).toEqual({
      ok: false,
      reason: 'invalid_replacement',
    })
    expect(updates()).toHaveLength(0)
    expect(eventInserts()).toHaveLength(0)
  })

  it('refuses an article that is already superseded', async () => {
    article('superseded')
    const { supersedeArticle } = await import('@/lib/db/queries/kb-review-state')
    expect(await supersedeArticle({ articleId: 7, userId: 12, replacement: { url: 'https://x.test/' } }, 3)).toEqual({
      ok: false,
      reason: 'wrong_state',
    })
  })
})

describe('restoreArticle', () => {
  it('brings a superseded article back to current and drops its replacement', async () => {
    article('superseded')
    const { restoreArticle } = await import('@/lib/db/queries/kb-review-state')
    expect(await restoreArticle({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: true })
    expect(assignments(updates()[0])).toMatchObject({
      review_state: 'current',
      superseded_by_article_id: null,
      superseded_by_url: null,
    })
    expect(inserted(eventInserts()[0])).toMatchObject({ type: 'restored', actor_user_id: 12, origin: 'manual' })
  })

  it.each(['current', 'needs_review'])('refuses an article that is %s', async (state) => {
    article(state)
    const { restoreArticle } = await import('@/lib/db/queries/kb-review-state')
    expect(await restoreArticle({ articleId: 7, userId: 12 }, 3)).toEqual({ ok: false, reason: 'wrong_state' })
    expect(updates()).toHaveLength(0)
  })
})

describe('automatic needs-review flag on an edit', () => {
  const autoFlag = () => calls.find((c) => c.sql.startsWith('update "kb_articles" set "review_state"'))

  it('flags only a current, verified article whose new text differs from what was verified, in one statement', async () => {
    const { recordArticleEvent } = await import('@/lib/db/queries/kb-events')
    const { getDb } = await import('@/lib/db/drizzle')
    await recordArticleEvent(getDb(), { orgId: 3, articleId: 7, type: 'edited', origin: 'sync', contentHash: 'new' })

    const update = autoFlag()!
    expect(update.sql).toContain('"review_state" = $')
    expect(update.sql).toContain('"verified_at" is not null')
    expect(update.sql).toMatch(/"verified_content_hash" is distinct from \$\d+/)
    expect(update.sql).toContain('returning "id"')
    expect(update.params).toEqual(expect.arrayContaining([7, 3, 'current', 'new']))
    expect(assignments(update)).toMatchObject({ review_state: 'needs_review', review_note: null })
  })

  it('records an automatic flag with the edit’s actor and origin when an article was flagged', async () => {
    respond = (c) => (c.sql.startsWith('update "kb_articles" set "review_state"') ? [[7]] : [])
    const { recordArticleEvent } = await import('@/lib/db/queries/kb-events')
    const { getDb } = await import('@/lib/db/drizzle')
    await recordArticleEvent(getDb(), {
      orgId: 3,
      articleId: 7,
      type: 'edited',
      actorUserId: 99,
      origin: 'ticket_promotion',
      contentHash: 'new',
    })
    const events = eventInserts().map(inserted)
    expect(events.map((e) => e.type)).toEqual(['edited', 'auto_flagged_for_review'])
    expect(events[1]).toMatchObject({ actor_user_id: 99, origin: 'ticket_promotion', content_hash: 'new', article_id: 7 })
    expect(assignments(autoFlag()!).review_state_by).toBe(99)
  })

  it('adds nothing when no article matched (never verified, unchanged from verified, or not current)', async () => {
    const { recordArticleEvent } = await import('@/lib/db/queries/kb-events')
    const { getDb } = await import('@/lib/db/drizzle')
    await recordArticleEvent(getDb(), { orgId: 3, articleId: 7, type: 'edited', origin: 'import', contentHash: 'new' })
    expect(eventInserts().map(inserted).map((e) => e.type)).toEqual(['edited'])
  })

  it.each(['created', 'promoted', 'verified', 'flagged_for_review', 'superseded'] as const)(
    'never runs for a %s event',
    async (type) => {
      const { recordArticleEvent } = await import('@/lib/db/queries/kb-events')
      const { getDb } = await import('@/lib/db/drizzle')
      await recordArticleEvent(getDb(), { orgId: 3, articleId: 7, type, origin: 'manual', contentHash: 'h' })
      expect(autoFlag()).toBeUndefined()
    }
  )
})

describe('verifyArticle and the needs-review flag', () => {
  const found = (c: Call) => (c.sql.startsWith('select') ? [[Q, A]] : [])

  it('clears a needs-review flag and records that before the verification', async () => {
    respond = (c) =>
      c.sql.startsWith('update "kb_articles" set "review_state"') ? [[7]] : found(c)
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12 }, 3)

    const clear = calls.find((c) => c.sql.startsWith('update "kb_articles" set "review_state"'))!
    expect(clear.params).toEqual(expect.arrayContaining(['needs_review', 7, 3]))
    expect(assignments(clear)).toMatchObject({ review_state: 'current', review_note: null, review_state_by: 12 })
    expect(eventInserts().map(inserted).map((e) => e.type)).toEqual(['review_flag_cleared', 'verified'])
  })

  it('records only the verification when the article was not flagged', async () => {
    respond = found
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12 }, 3)
    expect(eventInserts().map(inserted).map((e) => e.type)).toEqual(['verified'])
  })
})

describe('retrieval leaves superseded articles out, and only those', () => {
  const articleQuery = () =>
    calls.find((c) => c.sql.startsWith('select') && c.sql.includes('from "kb_articles"') && !c.sql.includes('pg_extension'))!

  it('searchArticles excludes superseded articles and keeps needs-review ones', async () => {
    respond = (c) => (c.sql.includes('pg_extension') ? [['0.8.0']] : [])
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1, 0.2], 5, 3)
    const q = articleQuery()
    expect(q.sql).toMatch(/"kb_articles"\."review_state" <> \$\d+/)
    expect(q.params).toContain('superseded')
    expect(q.params).not.toContain('needs_review')
    expect(q.sql).toMatch(/"kb_articles"\."published" = \$\d+/)
  })

  it('textSearchArticles excludes superseded articles and keeps needs-review ones', async () => {
    const { textSearchArticles } = await import('@/lib/db/queries/kb')
    await textSearchArticles('reset', 5, 3)
    const q = articleQuery()
    expect(q.sql).toMatch(/"kb_articles"\."review_state" <> \$\d+/)
    expect(q.params).toContain('superseded')
    expect(q.params).not.toContain('needs_review')
  })

  it('the widget and ticket context go through the same filtered search', async () => {
    respond = (c) => (c.sql.includes('pg_extension') ? [['0.8.0']] : [])
    const { getKBContext, getWidgetKBContext } = await import('@/lib/db/queries/kb')
    await getKBContext([0.1], 3, 3)
    await getWidgetKBContext([0.1], 3, 3)
    const searches = calls.filter((c) => c.sql.startsWith('select') && c.sql.includes('"embedding_vec" <=>'))
    expect(searches.length).toBeGreaterThanOrEqual(2)
    for (const s of searches) expect(s.params).toContain('superseded')
  })
})
