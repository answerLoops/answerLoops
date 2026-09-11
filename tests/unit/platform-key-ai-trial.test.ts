import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'

// A brand-new org with no AI provider configured gets 5 lifetime free
// tickets fully AI-processed on answerLoops' own platform key, so they see
// auto-triage/drafting/deflection actually work before deciding whether to
// add their own key. After the 5th, a dashboard banner tells them to add
// one. User-requested: "let a user see the whole platform working before
// they add their own key... reduce friction so they can hit the ground
// running out of the gate."
//
// reservePlatformKeyTrial's single UPDATE...WHERE...RETURNING is the
// correctness-critical piece — same reasoning as getNextOrgTicketNumber
// (tests/unit/org-ticket-numbers.test.ts): it has to be race-safe under
// concurrent tickets for the same org without a separate advisory lock,
// which only holds if the "still under the limit" check and the increment
// land in the same statement Postgres's row-level lock protects. Verified
// against drizzle's pg-proxy driver (compiled SQL, no real connection).
//
// The pipeline-behavior tests (does a ticket actually get 'trial' vs
// 'production' threaded through) live in a separate file
// (platform-key-ai-trial-pipeline.test.ts) — vi.mock hoists to the top of
// the whole file regardless of which describe block it's written in, so
// mixing a dynamic-import test of this real module with a static mock of
// the same module in one file makes them fight over which mock wins.

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('lib/billing/platform-key-trial.ts — atomic reservation', () => {
  it('reservePlatformKeyTrial issues one UPDATE with the limit check and the increment in the same statement', () => {
    const src = read('lib/billing/platform-key-trial.ts')
    const fnIdx = src.indexOf('export async function reservePlatformKeyTrial')
    const fnBody = src.slice(fnIdx)
    expect(fnBody).toContain('UPDATE orgs')
    expect(fnBody).toContain('platform_key_trial_used = platform_key_trial_used + 1')
    expect(fnBody).toContain('platform_key_trial_used <')
    expect(fnBody).toContain('RETURNING')
  })

  it('grants a reservation when the row-returning UPDATE returns a row (still under the limit)', async () => {
    vi.resetModules()
    const fakeDb = drizzle(async () => ({ rows: [[1]] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    const { reservePlatformKeyTrial } = await import('@/lib/billing/platform-key-trial')
    const granted = await reservePlatformKeyTrial(3)
    expect(granted).toBe(true)
  })

  it('denies a reservation when the UPDATE returns no row (already at the limit)', async () => {
    vi.resetModules()
    const fakeDb = drizzle(async () => ({ rows: [] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    const { reservePlatformKeyTrial } = await import('@/lib/billing/platform-key-trial')
    const granted = await reservePlatformKeyTrial(3)
    expect(granted).toBe(false)
  })

  it('getPlatformKeyTrialStatus computes remaining and exhausted from the stored used count', async () => {
    vi.resetModules()
    const fakeDb = drizzle(async () => ({ rows: [{ used: 3 }] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    const { getPlatformKeyTrialStatus, PLATFORM_KEY_TRIAL_LIMIT } = await import('@/lib/billing/platform-key-trial')
    const status = await getPlatformKeyTrialStatus(3)
    expect(status.used).toBe(3)
    expect(status.limit).toBe(PLATFORM_KEY_TRIAL_LIMIT)
    expect(status.remaining).toBe(PLATFORM_KEY_TRIAL_LIMIT - 3)
    expect(status.exhausted).toBe(false)
  })

  it('getPlatformKeyTrialStatus reports exhausted once used reaches the limit', async () => {
    vi.resetModules()
    const fakeDb = drizzle(async () => ({ rows: [{ used: 5 }] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    const { getPlatformKeyTrialStatus } = await import('@/lib/billing/platform-key-trial')
    const status = await getPlatformKeyTrialStatus(3)
    expect(status.exhausted).toBe(true)
    expect(status.remaining).toBe(0)
  })
})

describe('lib/ai/models.ts — trial purpose', () => {
  it('platformKeyAllowed treats trial the same as sandbox: always allowed regardless of deployment mode', () => {
    const src = read('lib/ai/models.ts')
    const fnIdx = src.indexOf('function platformKeyAllowed')
    const fnBody = src.slice(fnIdx, src.indexOf('}', fnIdx) + 1)
    expect(fnBody).toContain("purpose === 'sandbox'")
    expect(fnBody).toContain("purpose === 'trial'")
  })

  it("ModelPurpose's type documents that 'trial' must only be passed after an atomic reservation", () => {
    const src = read('lib/ai/models.ts')
    expect(src).toContain("export type ModelPurpose = 'production' | 'sandbox' | 'trial'")
  })
})

describe('lib/ingest/pipeline.ts — ticket-level trial reservation, not per model call', () => {
  it('reserves the trial once, before triage, gated on the org having no key and not being self-hosted', () => {
    const src = read('lib/ingest/pipeline.ts')
    const reserveIdx = src.indexOf('reservePlatformKeyTrial(orgId)')
    const triageIdx = src.indexOf('triageMessage(content, orgId, aiPurpose)')
    expect(reserveIdx).toBeGreaterThan(-1)
    expect(triageIdx).toBeGreaterThan(reserveIdx)
    expect(src).toContain("getDeploymentMode() !== 'self-hosted' && !(await orgHasAIKey(orgId))")
  })

  it('threads the same aiPurpose decision into embedText and runAIAgent, not a fresh decision per call', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toContain('embedText(`${summary}\\n\\n${content}`, orgId, aiPurpose)')
    expect(src).toContain(
      "runAIAgent(ticketId, content, threadId ?? channelId, priorAnswers, orgId, platform, category ?? 'general_question', duplicates, orgTicketNumber, aiPurpose, channelId, threadId)"
    )
  })
})
