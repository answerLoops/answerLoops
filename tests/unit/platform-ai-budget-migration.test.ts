import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Spend for included platform AI usage: trial spend accumulates on orgs for
// the whole trial, paid-plan spend per UTC month in platform_ai_usage. Source
// assertions catch the migration and schema.ts drifting apart (a rename in one
// but not the other only fails at runtime, inside a raw sql`` statement).

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8')
const MIGRATION = 'drizzle/0052_platform_ai_budget.sql'

describe(MIGRATION, () => {
  it('adds both trial spend columns to orgs, idempotently, as non-null bigint defaulting to 0', () => {
    const sql = read(MIGRATION)
    for (const col of ['trial_chat_spend_micros', 'trial_embedding_spend_micros']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ${col} bigint NOT NULL DEFAULT 0`, 'i'))
    }
  })

  it('creates platform_ai_usage keyed by (org_id, period), cascading on org delete', () => {
    const sql = read(MIGRATION)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS platform_ai_usage/i)
    expect(sql).toMatch(/org_id\s+integer NOT NULL REFERENCES orgs\(id\) ON DELETE CASCADE/i)
    expect(sql).toMatch(/PRIMARY KEY \(org_id, period\)/i)
  })

  it('drops the old 5-ticket counter', () => {
    expect(read(MIGRATION)).toMatch(/ALTER TABLE orgs DROP COLUMN IF EXISTS platform_key_trial_used/i)
  })

  it('contains no budget amounts', () => {
    expect(read(MIGRATION)).not.toMatch(/\$\d|USD/i)
  })
})

describe('lib/db/schema.ts', () => {
  const src = read('lib/db/schema.ts')

  it('maps the trial spend columns on orgs', () => {
    expect(src).toMatch(/trialChatSpendMicros:\s*bigint\('trial_chat_spend_micros', \{ mode: 'number' \}\)\.notNull\(\)\.default\(0\)/)
    expect(src).toMatch(/trialEmbeddingSpendMicros:\s*bigint\('trial_embedding_spend_micros', \{ mode: 'number' \}\)\.notNull\(\)\.default\(0\)/)
  })

  it('no longer declares platformKeyTrialUsed', () => {
    expect(src).not.toContain('platformKeyTrialUsed')
  })

  it('declares platformAiUsage', () => {
    expect(src).toContain("export const platformAiUsage = pgTable(\n  'platform_ai_usage'")
  })
})
