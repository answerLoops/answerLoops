import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgSelectBase, PgUpdateBase } from 'drizzle-orm/pg-core'
import { hashBotSecret, generateBotSecret } from '@/lib/ingest/bot-secret'

// Per-integration shared secrets are looked up by SHA-256 digest, per
// platform; the value that has to be read back (Telegram setWebhook,
// Discourse/Circle webhook setup, the bot's outbound bearer) is kept
// encrypted, and rows written before the digest existed are upgraded on read.

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))
vi.mock('@/lib/crypto/tokens', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

interface Captured {
  sql: string
  params: unknown[]
}

function intercept(proto: object, execResult: (kind: string) => unknown[], kind: string, into: Captured[]) {
  vi.spyOn(proto as unknown as { _prepare: () => unknown }, '_prepare').mockImplementation(function (this: unknown) {
    into.push((this as { toSQL(): Captured }).toSQL())
    return { execute: () => Promise.resolve(execResult(kind)) }
  })
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 4, orgId: 7, platform: 'discord', botToken: null, botSecret: null, botSecretHash: null, botSecretEnc: null,
    pairingCodeHash: null, pairingCodeEnc: null, pairingCodeExpiresAt: null, botUsername: null, channelIds: null,
    guildChannelMap: null, teamId: null, webhookSecret: null, webhookRegisteredAt: null, escalationRoleId: null,
    connectedGuildId: null, confidenceThreshold: 0.8, enabled: 1, autoDeflectEnabled: 0, emailSendMethod: 'platform',
    createdAt: 'now', updatedAt: 'now', ...overrides,
  }
}

describe('bot secret helpers', () => {
  it('hashBotSecret is the hex SHA-256 of the secret', () => {
    expect(hashBotSecret('abc')).toBe(createHash('sha256').update('abc').digest('hex'))
    expect(hashBotSecret('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashBotSecret('abc')).not.toBe(hashBotSecret('abd'))
  })

  it('generateBotSecret returns 256 bits of fresh hex each time', () => {
    const a = generateBotSecret()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(generateBotSecret()).not.toBe(a)
  })
})

describe('getIntegrationByBotSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDb.mockReturnValue(drizzle.mock())
  })
  afterEach(() => vi.restoreAllMocks())

  it('matches on the digest, restricts to the requested platform and to enabled rows, and breaks ties by id', async () => {
    const selects: Captured[] = []
    intercept(PgSelectBase.prototype, () => [row({ botSecretEnc: 'enc:raw-secret', botSecretHash: hashBotSecret('raw-secret') })], 'select', selects)
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')

    const found = await getIntegrationByBotSecret('raw-secret', 'telegram')

    expect(found?.bot_secret).toBe('raw-secret')
    const { sql, params } = selects[0]
    expect(sql).toContain('"bot_secret_hash" =')
    expect(params).toContain(hashBotSecret('raw-secret'))
    expect(sql).toMatch(/"platform" in \(/i)
    expect(params).toContain('telegram')
    expect(sql).toContain('"enabled" =')
    expect(sql).toMatch(/order by "integrations"\."id"/i)
  })

  it('matches on the digest only, with no comparison against the plaintext column', async () => {
    const selects: Captured[] = []
    intercept(PgSelectBase.prototype, () => [], 'select', selects)
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')
    await getIntegrationByBotSecret('raw-secret', 'telegram')
    expect(selects[0].sql).not.toContain('"bot_secret" =')
    expect(selects[0].sql).not.toMatch(/"bot_secret_hash" is null/i)
    expect(selects[0].params).not.toContain('raw-secret')
  })

  it('accepts a list of platforms', async () => {
    const selects: Captured[] = []
    intercept(PgSelectBase.prototype, () => [], 'select', selects)
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')
    await getIntegrationByBotSecret('s', ['discord', 'slack'])
    expect(selects[0].params).toEqual(expect.arrayContaining(['discord', 'slack']))
    expect(selects[0].params).not.toContain('telegram')
  })

  it('never queries for google_chat, and returns null for an empty secret', async () => {
    const selects: Captured[] = []
    intercept(PgSelectBase.prototype, () => [row()], 'select', selects)
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')
    expect(await getIntegrationByBotSecret('gc_code', 'google_chat')).toBeNull()
    expect(await getIntegrationByBotSecret('gc_code', ['google_chat'])).toBeNull()
    expect(await getIntegrationByBotSecret('', 'discord')).toBeNull()
    expect(selects).toHaveLength(0)
  })

  it('upgrades a row that still holds the legacy plaintext: stores digest + encrypted copy and clears the plaintext', async () => {
    const selects: Captured[] = []
    const updates: Captured[] = []
    intercept(PgSelectBase.prototype, () => [row({ botSecret: 'legacy-secret' })], 'select', selects)
    intercept(PgUpdateBase.prototype, () => [], 'update', updates)
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')

    const found = await getIntegrationByBotSecret('legacy-secret', 'discord')

    expect(found?.bot_secret).toBe('legacy-secret')
    expect(updates).toHaveLength(1)
    expect(updates[0].params).toEqual(expect.arrayContaining(['enc:legacy-secret', hashBotSecret('legacy-secret')]))
    expect(updates[0].sql).toContain('"bot_secret" = $')
    expect(updates[0].params).toContain(null)
    // Only upgrades a row nobody else has upgraded already.
    expect(updates[0].sql).toContain('"bot_secret_enc" is null')
  })

  it('does not touch a row that is already upgraded', async () => {
    const updates: Captured[] = []
    intercept(PgSelectBase.prototype, () => [row({ botSecretEnc: 'enc:x', botSecretHash: hashBotSecret('x') })], 'select', [])
    intercept(PgUpdateBase.prototype, () => [], 'update', updates)
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')
    await getIntegrationByBotSecret('x', 'discord')
    expect(updates).toHaveLength(0)
  })
})

describe('migration 0047', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'drizzle/0047_integration_secret_storage.sql'), 'utf-8')

  it('adds the digest, encrypted-copy and pairing columns', () => {
    for (const col of ['bot_secret_hash', 'bot_secret_enc', 'pairing_code_hash', 'pairing_code_enc', 'pairing_code_expires_at']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col} TEXT`)
    }
  })

  it('hashes every existing secret with SHA-256 and indexes the digest uniquely', () => {
    expect(sql).toContain("SET bot_secret_hash = encode(sha256(convert_to(bot_secret, 'UTF8')), 'hex')")
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS integrations_bot_secret_hash_unique')
  })

  it('moves a pending Google Chat code into the pairing columns with an expiry, and drops it from bot_secret', () => {
    expect(sql).toMatch(/pairing_code_hash = encode\(sha256/)
    expect(sql).toMatch(/pairing_code_expires_at = /)
    expect(sql).toMatch(/platform = 'google_chat'\s+AND bot_secret IS NOT NULL\s+AND team_id IS NULL/)
  })

  it('clears the shared secret of paired Google Chat rows, and does that before hashing the rest', () => {
    const clear = sql.indexOf("SET bot_secret = NULL\nWHERE platform = 'google_chat'")
    const hashAll = sql.indexOf('SET bot_secret_hash = encode')
    expect(clear).toBeGreaterThan(-1)
    expect(clear).toBeLessThan(hashAll)
  })
})

describe('consumers that must read the secret back keep working', () => {
  it('Integration.bot_secret is the decrypted value for platforms that configure a remote webhook', async () => {
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([row({ platform: 'telegram', botSecretEnc: 'enc:tg-secret', botSecretHash: 'h' })]) }) }) }),
    })
    const { getIntegration } = await import('@/lib/db/queries/integrations')
    expect((await getIntegration(7, 'telegram'))?.bot_secret).toBe('tg-secret')
  })
})
