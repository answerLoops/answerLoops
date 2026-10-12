import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Source-shape coverage for where the review queue hooks into the live answer
// paths, and for the tenant/consistency rules of its query module. Behaviour of
// the capture helper itself is in kb-review-capture.test.ts.

const ROOT = process.cwd()
const src = (rel: string) => {
  const abs = path.join(ROOT, rel)
  expect(fs.existsSync(abs), `File not found: ${rel}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('ticket path (lib/ai/agent.ts)', () => {
  it('captures only when no KB or prior answer covered the question', () => {
    const s = src('lib/ai/agent.ts')
    expect(s).toContain("import { captureUnansweredQuestion } from '@/lib/kb/review-capture'")
    const guard = s.indexOf('if (priorAnswers.length === 0) {')
    expect(guard).toBeGreaterThan(-1)
    expect(s.indexOf('captureUnansweredQuestion({', guard)).toBeGreaterThan(guard)
  })

  it('captures after the reply path, so it cannot delay an answer', () => {
    const s = src('lib/ai/agent.ts')
    expect(s.indexOf('captureUnansweredQuestion({')).toBeGreaterThan(s.indexOf('routed to human review — draft held for approval'))
  })

  it('only forwards the draft as the answer when the grader judged it a full answer', () => {
    expect(src('lib/ai/agent.ts')).toContain("answer: assessment.answered_fully ? text : ''")
  })
})

describe('widget path (app/api/widget/chat/route.ts)', () => {
  it('captures only when retrieval found nothing and never sends visitor identity', () => {
    const s = src('app/api/widget/chat/route.ts')
    const guard = s.indexOf('if (allContext.length === 0) {')
    expect(guard).toBeGreaterThan(-1)
    const call = s.slice(s.indexOf('captureUnansweredQuestion({', guard), s.indexOf('})', s.indexOf('captureUnansweredQuestion({', guard)))
    expect(call).toContain("source: 'widget'")
    expect(call).not.toContain('visitorId')
  })
})

describe('lib/db/queries/kb-review.ts', () => {
  const s = () => src('lib/db/queries/kb-review.ts')

  it('scopes every read and write by org id', () => {
    const body = s()
    // each query builder that touches the table filters on orgId
    expect((body.match(/eq\(kbReviewItems\.orgId, orgId\)/g) ?? []).length).toBeGreaterThanOrEqual(8)
  })

  it('claims an item with a conditional update inside the approval transaction', () => {
    const body = s()
    const tx = body.slice(body.indexOf('export async function approveReviewItem'))
    expect(tx).toContain('.transaction(')
    expect(tx).toContain("eq(kbReviewItems.status, 'pending')")
    expect(tx.indexOf("status: 'approved'")).toBeLessThan(tx.indexOf('.insert(kbArticles)'))
  })

  it('caps how many items can wait for review', () => {
    expect(s()).toContain('MAX_PENDING_REVIEW_ITEMS')
  })
})

describe('migration 0051', () => {
  const sql = () => src('drizzle/0051_kb_review_items.sql')

  it('is idempotent so the custom runner can re-apply it', () => {
    const s = sql()
    expect(s).toContain('CREATE TABLE IF NOT EXISTS kb_review_items')
    expect(s).toContain('CREATE INDEX IF NOT EXISTS')
    expect(s).toContain('EXCEPTION')
  })

  it('constrains status and source and cascades with the org', () => {
    const s = sql()
    expect(s).toContain("CHECK (status IN ('pending', 'approved', 'rejected'))")
    expect(s).toContain("CHECK (source IN ('ticket', 'widget'))")
    expect(s).toContain('org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE')
  })

  it('matches the schema.ts table definition', () => {
    const schema = src('lib/db/schema.ts')
    const table = schema.slice(schema.indexOf("'kb_review_items'"))
    for (const col of ['org_id', 'source', 'ticket_id', 'question', 'answer', 'embedding_vec', 'confidence', 'occurrences', 'status', 'article_id', 'reviewed_by', 'reviewed_at']) {
      expect(table.slice(0, 2500)).toContain(`'${col}'`)
      expect(sql()).toContain(col)
    }
  })
})
