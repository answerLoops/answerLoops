import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { productFeedbackVotes } from '@/lib/db/schema'

// Source-level checks for the feedback board's up-vote storage, same style as
// product-feedback-infra.test.ts: no live DB, so we pin the pieces the spec
// turns into database constraints — one vote per person, votes vanish with the
// workspace, and no vote direction anywhere — plus the trigger that keeps the
// panel live.

const ROOT = process.cwd()
const read = (rel: string) => {
  const abs = path.join(ROOT, rel)
  expect(fs.existsSync(abs), `File not found: ${rel}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}
const flat = (s: string) => s.replace(/\s+/g, ' ')

const MIGRATION = 'drizzle/0072_product_feedback_votes.sql'

describe('migration 0072_product_feedback_votes.sql', () => {
  const raw = read(MIGRATION)
  const sql = flat(raw)

  it('creates the votes table idempotently', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS product_feedback_votes')
  })

  it('allows exactly one vote per person per entry', () => {
    expect(sql).toMatch(/UNIQUE \(feedback_id, user_id\)/)
  })

  it('cascades from the entry, the voter, and the voter workspace', () => {
    expect(sql).toMatch(/feedback_id INTEGER NOT NULL REFERENCES product_feedback\(id\) ON DELETE CASCADE/)
    expect(sql).toMatch(/user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
    expect(sql).toMatch(/org_id INTEGER NOT NULL REFERENCES orgs\(id\) ON DELETE CASCADE/)
  })

  it('has no vote direction — an up-vote is a row, nothing else', () => {
    // The rule is about the schema, so comments (which may say "no down-vote")
    // are stripped before checking.
    const code = flat(raw.replace(/--.*$/gm, ''))
    expect(code).not.toMatch(/\bdown\b/i)
    expect(code).not.toMatch(/\bdirection\b|\bvalue\b|\bscore\b/i)
  })

  it('indexes the entry so counting per entry is cheap', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_product_feedback_votes_feedback ON product_feedback_votes (feedback_id)')
  })

  it('wakes the panel through the existing board channel', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_product_feedback_votes_changed ON product_feedback_votes')
    expect(sql).toMatch(
      /CREATE TRIGGER trg_product_feedback_votes_changed AFTER INSERT OR UPDATE OR DELETE ON product_feedback_votes FOR EACH ROW EXECUTE FUNCTION notify_product_feedback_changed\(\)/,
    )
    // Reuses the function 0046 defined; never redefines the channel.
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION')
    expect(sql).not.toContain('pg_notify(')
  })

  it('does not seed rows', () => {
    expect(sql).not.toContain('INSERT INTO')
  })

  it('leaves migration 0046 free of any vote column', () => {
    expect(flat(read('drizzle/0046_product_feedback.sql'))).not.toMatch(/\bvote\b/)
  })

  it('matches the drizzle schema column for column', () => {
    const m = raw.match(/CREATE TABLE IF NOT EXISTS product_feedback_votes \(([\s\S]*?)\n\);/)
    expect(m, 'votes table not found in migration').toBeTruthy()
    const cols = new Map<string, boolean>()
    for (const line0 of m![1].split('\n')) {
      const line = line0.replace(/--.*$/, '').trim().replace(/,$/, '')
      if (!line || /^(CONSTRAINT|UNIQUE)\b/.test(line)) continue
      cols.set(line.split(/\s+/)[0], /NOT NULL|PRIMARY KEY/.test(line))
    }
    const cfg = getTableConfig(productFeedbackVotes)
    expect([...cols.keys()].sort()).toEqual(cfg.columns.map((c) => c.name).sort())
    for (const c of cfg.columns) {
      expect(cols.get(c.name), `product_feedback_votes.${c.name} nullability`).toBe(c.notNull)
    }
    for (const idx of cfg.indexes) {
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS ${idx.config.name} ON product_feedback_votes`)
    }
  })
})

describe('workspace purge', () => {
  const src = read('lib/db/queries/orgs.ts')
  const purge = src.slice(src.indexOf('export async function hardPurgeOrg'))

  it('deletes the votes a workspace cast before its feedback entries', () => {
    const votes = purge.indexOf('tx.delete(productFeedbackVotes).where(eq(productFeedbackVotes.orgId, orgId))')
    const feedback = purge.indexOf('tx.delete(productFeedback).where(eq(productFeedback.orgId, orgId))')
    expect(votes, 'votes purge line missing').toBeGreaterThan(-1)
    expect(feedback, 'feedback purge line missing').toBeGreaterThan(-1)
    expect(votes).toBeLessThan(feedback)
  })
})
