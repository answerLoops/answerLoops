import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The 5-ticket platform-key allowance is replaced by included platform AI
// usage, decided per call by the model resolver (lib/ai/models.ts). Nothing
// reserves trial credits per ticket any more.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8')

describe('the 5-ticket platform-key allowance is gone', () => {
  it('its module no longer exists', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'lib/billing/platform-key-trial.ts'))).toBe(false)
  })

  it.each(['lib/ingest/pipeline.ts', 'app/api/ingest/retry-stuck/route.ts'])('%s neither reserves trial credits nor chooses a purpose', (file) => {
    const src = read(file)
    expect(src).not.toContain('reservePlatformKeyTrial')
    expect(src).not.toContain("'trial'")
    expect(src).not.toContain('aiPurpose')
  })

  it('runBackgroundEnrichment takes only the ticket and org', () => {
    expect(read('lib/ingest/pipeline.ts')).toMatch(/export async function runBackgroundEnrichment\(\s*ticket: Ticket,\s*orgId: number\s*\): Promise<void>/)
  })

  it.each([
    'lib/db/schema.ts', 'lib/db/queries/tickets.ts', 'lib/db/queries/ai-config.ts', 'lib/ai/agent.ts', 'lib/ai/models.ts',
    'app/(dashboard)/layout.tsx', 'app/(dashboard)/settings/page.tsx',
  ])('%s no longer mentions the old counter, limit or module', (f) => {
    expect(read(f)).not.toMatch(/platform_key_trial_used|PLATFORM_KEY_TRIAL_LIMIT|platform-key-trial|getPlatformKeyTrialStatus/)
  })
})
