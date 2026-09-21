import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { drizzle } from 'drizzle-orm/pg-proxy'

// The Telegram Settings card used to show the same "Register webhook" CTA
// forever, even after registration had already succeeded — there was no
// stored confirmation, so a customer had no way to tell "connected" apart
// from "connected but the webhook was never actually registered with
// Telegram". webhook_registered_at closes that gap: it is stamped only after
// a successful setWebhook call, cleared whenever a new bot token is saved
// (Telegram's setWebhook/getWebhookInfo is keyed to the token, so a stale
// timestamp next to a rotated token would lie), and surfaced by the route
// that drives the "Register webhook" button.

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('drizzle/0042_telegram_webhook_registered_at.sql', () => {
  const file = path.join(ROOT, 'drizzle/0042_telegram_webhook_registered_at.sql')

  it('exists and is non-empty', () => {
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, 'utf-8').trim().length).toBeGreaterThan(0)
  })

  it('adds the webhook_registered_at TEXT column to integrations, guarded with IF NOT EXISTS', () => {
    const sql = fs.readFileSync(file, 'utf-8')
    expect(sql).toContain(
      'ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_registered_at TEXT;'
    )
  })
})

describe('lib/db/schema.ts: integrations.webhookRegisteredAt', () => {
  it('the integrations table defines webhookRegisteredAt', async () => {
    const { integrations } = await import('../../lib/db/schema')
    const cols = integrations as unknown as Record<string, unknown>
    expect(cols).toHaveProperty('webhookRegisteredAt')
  })

  it('the schema source maps it to the webhook_registered_at column', () => {
    const schemaSrc = read('lib/db/schema.ts')
    expect(schemaSrc).toContain("webhook_registered_at")
  })
})

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))
vi.mock('@/lib/crypto/tokens', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    orgId: 7,
    platform: 'telegram',
    botToken: null,
    botSecret: null,
    botUsername: null,
    channelIds: null,
    guildChannelMap: null,
    connectedGuildId: null,
    teamId: null,
    webhookSecret: null,
    webhookRegisteredAt: null,
    escalationRoleId: null,
    confidenceThreshold: 0.8,
    enabled: 1,
    autoDeflectEnabled: 0,
    emailSendMethod: 'platform',
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  }
}

describe('markTelegramWebhookRegistered', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps webhookRegisteredAt with a real ISO timestamp', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    getDb.mockReturnValue({ update: () => ({ set }) })

    const { markTelegramWebhookRegistered } = await import('@/lib/db/queries/integrations')
    await markTelegramWebhookRegistered(7)

    expect(set).toHaveBeenCalledTimes(1)
    const setArg = set.mock.calls[0][0]
    expect(typeof setArg.webhookRegisteredAt).toBe('string')
    // Must be a real ISO timestamp, not a placeholder.
    expect(new Date(setArg.webhookRegisteredAt).toString()).not.toBe('Invalid Date')
    expect(where).toHaveBeenCalledTimes(1)
  })

  it('scopes the update to org_id + platform=telegram (verified against compiled SQL, no real connection)', async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
      calls.push({ sql: sqlText, params })
      return { rows: [] }
    })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.resetModules()

    const { markTelegramWebhookRegistered } = await import('@/lib/db/queries/integrations')
    await markTelegramWebhookRegistered(42)

    expect(calls.length).toBe(1)
    const sql = calls[0].sql.toLowerCase()
    expect(sql).toContain('org_id')
    expect(sql).toContain('platform')
    expect(sql).toContain('webhook_registered_at')
    expect(calls[0].params).toContain(42)
    expect(calls[0].params).toContain('telegram')

    // Restore the plain getDb mock for the remaining tests in this file.
    vi.doMock('@/lib/db/drizzle', () => ({ getDb }))
    vi.resetModules()
  })
})

describe('upsertIntegration — a new bot token clears the confirmed registration state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets webhookRegisteredAt to null when botToken is provided on an update', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([row({ webhookRegisteredAt: '2026-01-01T00:00:00.000Z' })]) }) }),
      }),
      update: () => ({ set }),
    })

    const { upsertIntegration } = await import('@/lib/db/queries/integrations')
    await upsertIntegration({ orgId: 7, platform: 'telegram', botToken: 'new-token-123' })

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ webhookRegisteredAt: null }))
  })

  it('leaves webhookRegisteredAt untouched (undefined) when botToken is not provided on an update', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([row({ webhookRegisteredAt: '2026-01-01T00:00:00.000Z' })]) }) }),
      }),
      update: () => ({ set }),
    })

    const { upsertIntegration } = await import('@/lib/db/queries/integrations')
    await upsertIntegration({ orgId: 7, platform: 'telegram', botUsername: 'new_username' })

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ webhookRegisteredAt: undefined }))
  })
})

describe('toIntegration(): webhook_registered_at mapping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps row.webhookRegisteredAt through to webhook_registered_at', async () => {
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([row({ webhookRegisteredAt: '2026-01-02T03:04:05.000Z' })]) }),
        }),
      }),
    })

    const { getIntegration } = await import('@/lib/db/queries/integrations')
    const result = await getIntegration(7, 'telegram')
    expect(result?.webhook_registered_at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('falls back to null when the row value is undefined', async () => {
    const r = row()
    delete (r as Record<string, unknown>).webhookRegisteredAt

    getDb.mockReturnValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([r]) }) }),
      }),
    })

    const { getIntegration } = await import('@/lib/db/queries/integrations')
    const result = await getIntegration(7, 'telegram')
    expect(result?.webhook_registered_at).toBeNull()
  })
})

describe('app/api/telegram/register/route.ts — marks registration on success only', () => {
  // Next.js route modules cannot be imported in vitest (matches
  // tests/unit/telegram-webhook-register.test.ts / discourse-webhook-route.test.ts) —
  // source-file assertions confirm the call is wired on the success branch and
  // absent from the failure branch.
  const src = read('app/api/telegram/register/route.ts')

  it('imports markTelegramWebhookRegistered from the integrations queries module', () => {
    expect(src).toContain(
      "import { getIntegration, markTelegramWebhookRegistered } from '@/lib/db/queries/integrations'"
    )
  })

  it('calls markTelegramWebhookRegistered(orgId) after a successful registerTelegramWebhook, before responding ok', () => {
    const resultCheckIdx = src.indexOf('if (!result.ok)')
    const markIdx = src.indexOf('await markTelegramWebhookRegistered(orgId)')
    const okReturnIdx = src.indexOf('return Response.json({ ok: true, webhookUrl: result.webhookUrl })')

    expect(resultCheckIdx).toBeGreaterThan(-1)
    expect(markIdx).toBeGreaterThan(-1)
    expect(okReturnIdx).toBeGreaterThan(-1)
    // The mark call is after the failure gate and before the success response.
    expect(markIdx).toBeGreaterThan(resultCheckIdx)
    expect(markIdx).toBeLessThan(okReturnIdx)
  })

  it('does not call markTelegramWebhookRegistered inside the failure branch', () => {
    const resultCheckIdx = src.indexOf('if (!result.ok)')
    const failureBranchEnd = src.indexOf('}', resultCheckIdx)
    const failureBranch = src.slice(resultCheckIdx, failureBranchEnd)
    expect(failureBranch).not.toContain('markTelegramWebhookRegistered')
  })
})
