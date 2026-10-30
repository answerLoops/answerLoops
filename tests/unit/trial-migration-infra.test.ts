import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { trialClaims, users } from '@/lib/db/schema'

const sqlText = fs.readFileSync(path.join(process.cwd(), 'drizzle/0067_free_trial_and_signup_consent.sql'), 'utf-8')
const sql = sqlText.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('0067 free trial migration', () => {
  it('makes both ledger keys unique, so the database refuses a second claim', () => {
    expect(sql).toMatch(/CONSTRAINT uq_trial_claims_identity_key UNIQUE \(identity_key\)/)
    expect(sql).toMatch(/CONSTRAINT uq_trial_claims_provider_subject UNIQUE \(provider_subject\)/)
  })

  it('does not cascade the ledger away with workspaces or users', () => {
    expect(sql).toContain('user_id INTEGER REFERENCES users(id) ON DELETE SET NULL')
    expect(sql).toContain('org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL')
    expect(sql).not.toMatch(/trial_claims[^;]*ON DELETE CASCADE/)
  })

  it('adds every new users column idempotently, with marketing opt-in off by default', () => {
    for (const col of ['provider_account_id', 'terms_accepted_at', 'terms_version', 'marketing_opt_in', 'marketing_opt_in_at', 'last_login_at']) {
      expect(sql).toContain(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`)
    }
    expect(sql).toContain('marketing_opt_in BOOLEAN NOT NULL DEFAULT false')
  })

  it('backfills the ledger for existing subscribers so they cannot trial again', () => {
    expect(sql).toMatch(/INSERT INTO trial_claims[\s\S]*FROM subscriptions/)
    expect(sql).toContain('ON CONFLICT DO NOTHING')
  })

  it('agrees with the Drizzle tables', () => {
    const claims = getTableConfig(trialClaims)
    expect(claims.name).toBe('trial_claims')
    for (const c of claims.columns) expect(sql).toContain(c.name)
    const userCols = getTableConfig(users).columns.map((c) => c.name)
    for (const col of ['provider_account_id', 'terms_accepted_at', 'terms_version', 'marketing_opt_in', 'marketing_opt_in_at', 'last_login_at']) {
      expect(userCols).toContain(col)
    }
  })
})

describe('0068 trial reminder migration', () => {
  const text = fs.readFileSync(path.join(process.cwd(), 'drizzle/0068_trial_ending_reminders.sql'), 'utf-8')
  const body = text.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

  it('adds both sent-at columns idempotently, null until sent', () => {
    expect(body).toContain('ADD COLUMN IF NOT EXISTS trial_reminder_3d_sent_at TIMESTAMPTZ;')
    expect(body).toContain('ADD COLUMN IF NOT EXISTS trial_reminder_1d_sent_at TIMESTAMPTZ;')
    expect(body).not.toMatch(/NOT NULL|DEFAULT/)
  })

  it('agrees with the Drizzle table', async () => {
    const { subscriptions } = await import('@/lib/db/schema')
    const cols = getTableConfig(subscriptions).columns.map((c) => c.name)
    expect(cols).toContain('trial_reminder_3d_sent_at')
    expect(cols).toContain('trial_reminder_1d_sent_at')
  })
})
