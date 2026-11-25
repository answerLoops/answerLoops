import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashBotSecret } from '@/lib/ingest/bot-secret'

// rotateCircleSecretAction replaces the Circle integration's inbound secret.
// The DB layer is replaced with a small in-memory store that keeps the secret
// the same way the real upsert does (an encrypted copy plus a SHA-256 lookup
// hash), so the test can check which secret still resolves afterwards.

type Row = { org_id: number; platform: string; team_id: string | null; bot_secret: string | null; bot_secret_hash: string | null; enabled: number }

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  orgHasFeature: vi.fn(async () => true),
  rows: new Map<string, Row>(),
}))

const key = (orgId: number, platform: string) => `${orgId}:${platform}`

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/integrations', async () => {
  const { hashBotSecret: hash } = await import('@/lib/ingest/bot-secret')
  return {
    getIntegration: vi.fn(async (orgId: number, platform: string) => h.rows.get(`${orgId}:${platform}`) ?? null),
    upsertIntegration: vi.fn(async (input: { orgId: number; platform: string; botSecret?: string | null; teamId?: string | null }) => {
      const k = `${input.orgId}:${input.platform}`
      const prev = h.rows.get(k)
      const next: Row = {
        org_id: input.orgId,
        platform: input.platform,
        team_id: input.teamId ?? prev?.team_id ?? null,
        bot_secret: input.botSecret ? input.botSecret : (prev?.bot_secret ?? null),
        bot_secret_hash: input.botSecret ? hash(input.botSecret) : (prev?.bot_secret_hash ?? null),
        enabled: 1,
      }
      h.rows.set(k, next)
      return next
    }),
    getIntegrationByBotSecret: vi.fn(async (secret: string, platform: string) => {
      const digest = hash(secret)
      for (const row of h.rows.values()) {
        if (row.platform === platform && row.enabled === 1 && row.bot_secret_hash === digest) return row
      }
      return null
    }),
    deleteIntegration: vi.fn(),
    issueGoogleChatPairingCode: vi.fn(),
  }
})
vi.mock('@/lib/db/queries/discord-guilds', () => ({ updateDiscordGuildChannels: vi.fn(), removeDiscordGuild: vi.fn() }))
vi.mock('@/lib/db/queries/email-domains', () => ({
  getEmailDomain: vi.fn(async () => null), upsertEmailDomain: vi.fn(), updateEmailDomainStatus: vi.fn(), deleteEmailDomain: vi.fn(),
}))
vi.mock('@/lib/email/domain', () => ({ registerDomain: vi.fn(), checkDomainStatus: vi.fn(), removeDomain: vi.fn() }))
vi.mock('@/lib/db/queries/email-oauth', () => ({ getEmailOauthConnection: vi.fn(async () => null), deleteEmailOauthConnection: vi.fn() }))
vi.mock('@/lib/email/gmail', () => ({ revokeGmailToken: vi.fn() }))
vi.mock('@/lib/email/outlook', () => ({ revokeOutlookToken: vi.fn() }))
vi.mock('@/lib/telegram/webhook', () => ({ registerTelegramWebhook: vi.fn() }))
vi.mock('@/lib/http/safe-url', () => ({
  UnsafeUrlError: class UnsafeUrlError extends Error {},
  assertPublicHttpsUrl: vi.fn(async (raw: string) => new URL(raw)),
}))

import { rotateCircleSecretAction, saveCircleIntegrationAction } from '@/lib/actions/integrations'
import { upsertIntegration, getIntegrationByBotSecret } from '@/lib/db/queries/integrations'

const OLD_SECRET = '<existing-circle-secret>'

function seedConnectedCircle(orgId = 7) {
  h.rows.set(key(orgId, 'circle'), {
    org_id: orgId,
    platform: 'circle',
    team_id: 'https://community.example.com',
    bot_secret: OLD_SECRET,
    bot_secret_hash: hashBotSecret(OLD_SECRET),
    enabled: 1,
  })
}

describe('rotateCircleSecretAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.rows.clear()
    h.orgHasFeature.mockResolvedValue(true)
  })

  it('refuses a plain member and leaves the secret unchanged', async () => {
    seedConnectedCircle()
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })

    const result = await rotateCircleSecretAction()

    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(upsertIntegration).not.toHaveBeenCalled()
    expect(await getIntegrationByBotSecret(OLD_SECRET, 'circle')).not.toBeNull()
  })

  it('refuses an org without the Circle entitlement and leaves the secret unchanged', async () => {
    seedConnectedCircle()
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })
    h.orgHasFeature.mockResolvedValue(false)

    const result = await rotateCircleSecretAction()

    expect(result?.error).toMatch(/requires the .+ plan/i)
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'circle_integration')
    expect(upsertIntegration).not.toHaveBeenCalled()
    expect(await getIntegrationByBotSecret(OLD_SECRET, 'circle')).not.toBeNull()
  })

  it('refuses when Circle is not connected, without creating a row', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })

    const result = await rotateCircleSecretAction()

    expect(result?.error).toMatch(/not connected/i)
    expect(upsertIntegration).not.toHaveBeenCalled()
    expect(h.rows.size).toBe(0)
  })

  it('gives an owner a new secret; the new one resolves and the old one no longer does', async () => {
    seedConnectedCircle()
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })

    const result = await rotateCircleSecretAction()

    expect(result?.error).toBeUndefined()
    const newSecret = result?.webhookSecret
    expect(newSecret).toMatch(/^[0-9a-f]{64}$/)
    expect(newSecret).not.toBe(OLD_SECRET)
    expect(result?.webhookUrl).toMatch(/\/api\/circle\/webhook$/)

    // Scoped to the caller's org and platform, and only the secret changes.
    expect(upsertIntegration).toHaveBeenCalledTimes(1)
    expect(upsertIntegration).toHaveBeenCalledWith({ orgId: 7, platform: 'circle', botSecret: newSecret })

    expect(await getIntegrationByBotSecret(OLD_SECRET, 'circle')).toBeNull()
    const resolved = await getIntegrationByBotSecret(newSecret!, 'circle')
    expect(resolved?.org_id).toBe(7)
    expect(resolved?.team_id).toBe('https://community.example.com')
  })

  it('an admin can rotate too, and only their own org is touched', async () => {
    seedConnectedCircle(7)
    seedConnectedCircle(8)
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 8, userId: 2, role: 'admin' })

    const result = await rotateCircleSecretAction()

    expect(result?.webhookSecret).toBeTruthy()
    expect(h.rows.get(key(7, 'circle'))?.bot_secret).toBe(OLD_SECRET)
    expect(h.rows.get(key(8, 'circle'))?.bot_secret).toBe(result?.webhookSecret)
  })

  it('two rotations produce two different secrets', async () => {
    seedConnectedCircle()
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })

    const first = await rotateCircleSecretAction()
    const second = await rotateCircleSecretAction()

    expect(first?.webhookSecret).not.toBe(second?.webhookSecret)
    expect(await getIntegrationByBotSecret(first!.webhookSecret!, 'circle')).toBeNull()
  })
})

describe('saveCircleIntegrationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.rows.clear()
    h.orgHasFeature.mockResolvedValue(true)
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })
  })

  it('keeps the existing secret on a re-save, so a rotated secret is not reverted', async () => {
    seedConnectedCircle()
    const form = new FormData()
    form.set('communityUrl', 'https://community.example.com')
    form.set('apiToken', '<circle-admin-token>')

    const result = await saveCircleIntegrationAction(null, form)

    expect(result?.webhookSecret).toBe(OLD_SECRET)
    expect(await getIntegrationByBotSecret(OLD_SECRET, 'circle')).not.toBeNull()
  })

  it('does not store an escalation user for Circle, and clears any value left from before', async () => {
    const form = new FormData()
    form.set('communityUrl', 'https://community.example.com')
    form.set('apiToken', '<circle-admin-token>')
    form.set('escalationUser', 'some-moderator')
    form.set('confidenceThreshold', '0.65')

    const result = await saveCircleIntegrationAction(null, form)

    expect(result?.error).toBeUndefined()
    expect(upsertIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'circle', escalationRoleId: null, confidenceThreshold: 0.65 })
    )
  })
})
