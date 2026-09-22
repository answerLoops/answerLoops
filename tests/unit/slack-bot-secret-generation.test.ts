import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real production bug found live: neither Slack save path (the OAuth
// callback used by the actual "Add to Slack" 1-click flow, or the manual
// self-hosted form) ever generated a bot_secret — every other platform's
// save action does (`existing?.bot_secret ?? crypto.randomBytes(32)...`).
// This was harmless while the Slack poller called processCommunityMessage
// directly in-process (no bot_secret needed), but once the poller was
// fixed to forward over HTTP to /api/ingest like Discord's bot does (same
// branch, see slack-poller-http-forward.test.ts), pollOrg's own guard
// against a missing bot_secret started silently skipping every org with
// one — which was *every* Slack-connected org, since none of them had ever
// had a bot_secret generated. This made the slack_force_polling override
// (an enterprise-only feature shipped earlier) impossible to actually use
// for a real customer: confirmed live against a real org connected via the
// OAuth flow, whose bot_secret had been null since the integration was
// first created.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))
vi.mock('@/lib/crypto/tokens', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

describe('Slack OAuth callback generates and preserves bot_secret', () => {
  it('generates a new bot_secret via crypto.randomBytes when none exists yet', () => {
    const src = read('app/api/slack/callback/route.ts')
    expect(src).toContain('crypto.randomBytes(32).toString')
    expect(src).toContain('existing?.bot_secret ?? crypto.randomBytes(32).toString')
  })

  it('passes botSecret into upsertIntegration, not just webhookSecret', () => {
    const src = read('app/api/slack/callback/route.ts')
    const callIdx = src.indexOf('await upsertIntegration({')
    const callBody = src.slice(callIdx, src.indexOf('})', callIdx))
    expect(callBody).toContain('botSecret,')
  })

  it('looks up the existing integration first, so reconnecting never rotates an already-issued secret', () => {
    const src = read('app/api/slack/callback/route.ts')
    const existingIdx = src.indexOf('const existing = await getIntegration(orgId')
    const secretIdx = src.indexOf('const botSecret =')
    expect(existingIdx).toBeGreaterThan(-1)
    expect(secretIdx).toBeGreaterThan(existingIdx)
  })
})

describe('saveSlackIntegrationAction (manual form) generates and preserves bot_secret', () => {
  it('generates a new bot_secret via crypto.randomBytes when none exists yet', () => {
    const src = read('lib/actions/integrations.ts')
    const fnIdx = src.indexOf('export async function saveSlackIntegrationAction')
    const nextFnIdx = src.indexOf('export async function', fnIdx + 1)
    const fnBody = src.slice(fnIdx, nextFnIdx)
    expect(fnBody).toContain('existingIntegration?.bot_secret ?? crypto.randomBytes(32).toString')
    expect(fnBody).toContain('botSecret,')
  })
})

describe('bot_secret generation behaves like every other platform', () => {
  it('Discord/Telegram/Email save actions already use the same existing-or-generate pattern', () => {
    const src = read('lib/actions/integrations.ts')
    const occurrences = src.match(/existing(?:Integration)?\?\.bot_secret \?\? crypto\.randomBytes\(32\)\.toString\('hex'\)/g)
    // Discord, Telegram, Email, and now Slack (manual form) — 4 platforms
    // in this file follow the same pattern.
    expect(occurrences?.length).toBeGreaterThanOrEqual(4)
  })
})

describe('lib/db/queries/integrations.ts — upsertIntegration actually persists botSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('an insert (no existing row) writes the provided botSecret', async () => {
    const values = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 1, botSecret: 'abc123' }]),
    })
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({ values }),
    })

    const { upsertIntegration } = await import('@/lib/db/queries/integrations')
    await upsertIntegration({ orgId: 3, platform: 'slack', botToken: 'xoxb-x', botSecret: 'abc123' })

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ botSecret: 'abc123' }))
  })
})
