import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgUpdateBase } from 'drizzle-orm/pg-core'

// Google Chat's unlisted-app install has no OAuth callback to learn the
// org↔space mapping the way Slack/Discord's OAuth flows do — pairing
// happens instead via a one-time code an org generates, posted as
// `/connect <code>` inside the Chat space after a Workspace admin adds the
// app. These tests cover the DB-layer half of that pairing: the redemption is
// a single UPDATE whose WHERE clause carries every rule (right platform,
// matching digest, not yet paired, not expired) and whose SET clause consumes
// the code. The real drizzle query builder renders the SQL; only execution is
// intercepted.

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

function captureUpdates(result: unknown[] | Error): Captured[] {
  const captured: Captured[] = []
  vi.spyOn(PgUpdateBase.prototype as unknown as { _prepare: () => unknown }, '_prepare').mockImplementation(function (this: unknown) {
    const { sql, params } = (this as { toSQL(): Captured }).toSQL()
    captured.push({ sql, params })
    return { execute: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)) }
  })
  return captured
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    orgId: 7,
    platform: 'google_chat',
    botToken: null,
    botSecret: null,
    botSecretHash: null,
    botSecretEnc: null,
    pairingCodeHash: null,
    pairingCodeEnc: null,
    pairingCodeExpiresAt: null,
    botUsername: null,
    channelIds: null,
    guildChannelMap: null,
    teamId: null,
    webhookSecret: null,
    webhookRegisteredAt: null,
    escalationRoleId: null,
    connectedGuildId: null,
    confidenceThreshold: 0.8,
    enabled: 0,
    autoDeflectEnabled: 0,
    emailSendMethod: 'platform',
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  }
}

describe('completeGoogleChatPairing — one atomic, single-use redemption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDb.mockReturnValue(drizzle.mock())
  })
  afterEach(() => vi.restoreAllMocks())

  it('matches only an unpaired google_chat row whose code digest matches and has not expired, and consumes the code in the same statement', async () => {
    const captured = captureUpdates([{ orgId: 7 }])
    const { completeGoogleChatPairing } = await import('@/lib/db/queries/integrations')
    const { hashBotSecret } = await import('@/lib/ingest/bot-secret')

    const result = await completeGoogleChatPairing('gc_abc123', 'spaces/AAAA111')

    expect(result).toEqual({ status: 'paired', orgId: 7 })
    expect(captured).toHaveLength(1)
    const { sql, params } = captured[0]
    // WHERE: platform, digest of the presented code (never the code itself),
    // still unpaired, still within the expiry window.
    expect(sql).toMatch(/where[\s\S]*"platform" = \$\d+/i)
    expect(sql).toContain('"pairing_code_hash" =')
    expect(sql).toContain('"team_id" is null')
    expect(sql).toMatch(/"pairing_code_expires_at" > /)
    expect(params).toContain(hashBotSecret('gc_abc123'))
    expect(params).not.toContain('gc_abc123')
    // SET: pairs the space and clears every pairing column.
    expect(params).toContain('spaces/AAAA111')
    expect(sql).toMatch(/set[\s\S]*"pairing_code_hash" = \$\d+/i)
    expect(sql).toMatch(/"pairing_code_enc" = \$\d+/)
    expect(sql).toMatch(/"pairing_code_expires_at" = \$\d+/)
    expect(sql).toContain('returning')
  })

  it('reports an invalid code (unknown, expired, already used, or integration already paired) when no row is updated', async () => {
    captureUpdates([])
    const { completeGoogleChatPairing } = await import('@/lib/db/queries/integrations')
    expect(await completeGoogleChatPairing('gc_used', 'spaces/AAAA111')).toEqual({ status: 'invalid' })
  })

  it('refuses an empty code or space without touching the database', async () => {
    const captured = captureUpdates([{ orgId: 7 }])
    const { completeGoogleChatPairing } = await import('@/lib/db/queries/integrations')
    expect(await completeGoogleChatPairing('', 'spaces/AAAA111')).toEqual({ status: 'invalid' })
    expect(await completeGoogleChatPairing('gc_abc123', '')).toEqual({ status: 'invalid' })
    expect(captured).toHaveLength(0)
  })

  it('reports space_in_use when another enabled integration already holds the space (unique violation)', async () => {
    captureUpdates(Object.assign(new Error('insert failed'), { cause: { code: '23505' } }))
    const { completeGoogleChatPairing } = await import('@/lib/db/queries/integrations')
    expect(await completeGoogleChatPairing('gc_abc123', 'spaces/TAKEN')).toEqual({ status: 'space_in_use' })
  })

  it('rethrows any other database failure', async () => {
    captureUpdates(new Error('connection lost'))
    const { completeGoogleChatPairing } = await import('@/lib/db/queries/integrations')
    await expect(completeGoogleChatPairing('gc_abc123', 'spaces/AAAA111')).rejects.toThrow('connection lost')
  })
})

describe('issueGoogleChatPairingCode', () => {
  beforeEach(() => vi.clearAllMocks())

  function selectReturning(rows: unknown[]) {
    return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
  }

  it('stores a digest, an encrypted copy and an expiry on a new row — never the plaintext code in bot_secret', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    getDb.mockReturnValue({ select: () => selectReturning([]), insert: () => ({ values }) })

    const { issueGoogleChatPairingCode } = await import('@/lib/db/queries/integrations')
    const { hashBotSecret } = await import('@/lib/ingest/bot-secret')
    const before = Date.now()
    const result = await issueGoogleChatPairingCode(7, 'gc_new')

    expect(result).toEqual({ status: 'issued', code: 'gc_new' })
    const written = values.mock.calls[0][0]
    expect(written.platform).toBe('google_chat')
    expect(written.enabled).toBe(0)
    expect(written.pairingCodeHash).toBe(hashBotSecret('gc_new'))
    expect(written.pairingCodeEnc).toBe('enc:gc_new')
    expect(written).not.toHaveProperty('botSecret')
    const expiresAt = Date.parse(written.pairingCodeExpiresAt)
    expect(expiresAt).toBeGreaterThan(before + 23 * 3600_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 3600_000)
  })

  it('returns an unexpired pending code as-is instead of minting another', async () => {
    const set = vi.fn()
    getDb.mockReturnValue({
      select: () => selectReturning([row({
        pairingCodeHash: 'h',
        pairingCodeEnc: 'enc:gc_existing',
        pairingCodeExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })]),
      update: () => ({ set }),
    })
    const { issueGoogleChatPairingCode } = await import('@/lib/db/queries/integrations')
    expect(await issueGoogleChatPairingCode(7, 'gc_new')).toEqual({ status: 'issued', code: 'gc_existing' })
    expect(set).not.toHaveBeenCalled()
  })

  it('replaces an expired pending code', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    getDb.mockReturnValue({
      select: () => selectReturning([row({
        pairingCodeHash: 'h',
        pairingCodeEnc: 'enc:gc_old',
        pairingCodeExpiresAt: new Date(Date.now() - 1000).toISOString(),
      })]),
      update: () => ({ set }),
    })
    const { issueGoogleChatPairingCode } = await import('@/lib/db/queries/integrations')
    expect(await issueGoogleChatPairingCode(7, 'gc_fresh')).toEqual({ status: 'issued', code: 'gc_fresh' })
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ enabled: 0, pairingCodeEnc: 'enc:gc_fresh' }))
  })

  it('refuses to issue a code for an integration that is already paired to a space', async () => {
    const set = vi.fn()
    getDb.mockReturnValue({
      select: () => selectReturning([row({ enabled: 1, teamId: 'spaces/AAAA111' })]),
      update: () => ({ set }),
    })
    const { issueGoogleChatPairingCode } = await import('@/lib/db/queries/integrations')
    expect(await issueGoogleChatPairingCode(7, 'gc_new')).toEqual({ status: 'already_paired' })
    expect(set).not.toHaveBeenCalled()
  })
})

describe('getIntegrationByGoogleChatSpace', () => {
  beforeEach(() => vi.clearAllMocks())

  it('finds an enabled, paired integration by space resourceName', async () => {
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve([row({ enabled: 1, teamId: 'spaces/AAAA111' })]) }),
          }),
        }),
      }),
    })
    const { getIntegrationByGoogleChatSpace } = await import('@/lib/db/queries/integrations')
    const result = await getIntegrationByGoogleChatSpace('spaces/AAAA111')
    expect(result?.org_id).toBe(7)
    // A paired Google Chat row carries no shared secret at all.
    expect(result?.bot_secret).toBeNull()
    expect(result?.pairing_code).toBeNull()
  })
})

describe('Integration view of a Google Chat row', () => {
  beforeEach(() => vi.clearAllMocks())

  function selectOne(r: unknown) {
    return { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([r]) }) }) }) }
  }

  it('exposes the pending code (as pairing_code and, for the settings card, bot_secret) only while it is unexpired and unpaired', async () => {
    getDb.mockReturnValue(selectOne(row({
      pairingCodeHash: 'h',
      pairingCodeEnc: 'enc:gc_pending',
      pairingCodeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })))
    const { getIntegration } = await import('@/lib/db/queries/integrations')
    const result = await getIntegration(7, 'google_chat')
    expect(result?.pairing_code).toBe('gc_pending')
    expect(result?.bot_secret).toBe('gc_pending')
  })

  it('hides an expired code', async () => {
    getDb.mockReturnValue(selectOne(row({
      pairingCodeHash: 'h',
      pairingCodeEnc: 'enc:gc_pending',
      pairingCodeExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    })))
    const { getIntegration } = await import('@/lib/db/queries/integrations')
    const result = await getIntegration(7, 'google_chat')
    expect(result?.pairing_code).toBeNull()
    expect(result?.bot_secret).toBeNull()
  })
})

describe('upsertIntegration — an unpaired google_chat row stays disabled', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saving other settings does not switch an unpaired row on', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([row()]) }) }) }),
      update: () => ({ set }),
    })
    const { upsertIntegration } = await import('@/lib/db/queries/integrations')
    await upsertIntegration({ orgId: 7, platform: 'google_chat', autoDeflectEnabled: true })
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ enabled: 0 }))
  })
})

describe('getIntegrationByBotSecret never resolves google_chat', () => {
  it('returns null for a google_chat-only lookup without querying', async () => {
    const select = vi.fn()
    getDb.mockReturnValue({ select })
    const { getIntegrationByBotSecret } = await import('@/lib/db/queries/integrations')
    expect(await getIntegrationByBotSecret('gc_abc123', 'google_chat')).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })
})

describe('generateGoogleChatConnectCodeAction', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/actions/integrations.ts'), 'utf-8')
  const fn = src.slice(
    src.indexOf('export async function generateGoogleChatConnectCodeAction'),
    src.indexOf('export async function saveGoogleChatSettingsAction'),
  )

  it('delegates to issueGoogleChatPairingCode, which is idempotent while a code is pending', () => {
    expect(fn).toContain('issueGoogleChatPairingCode(orgId,')
    expect(fn).toContain("issued.status === 'already_paired'")
    expect(fn).not.toContain('bot_secret')
  })
})
