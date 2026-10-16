import { eq, and, isNull, gt, inArray, asc, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { integrations } from '../schema'
import { encryptToken, decryptToken } from '@/lib/crypto/tokens'
import { hashBotSecret } from '@/lib/ingest/bot-secret'
import { isUniqueViolation } from '@/lib/ingest/db-errors'
import { logger } from '@/lib/logger'

const MOD = 'db/integrations'

/** How long a Google Chat /connect code stays valid after it is issued. */
export const GOOGLE_CHAT_PAIRING_TTL_MS = 24 * 60 * 60 * 1000

export type Platform = 'discord' | 'slack' | 'telegram' | 'email' | 'google_chat' | 'discourse' | 'circle'

export interface Integration {
  id: number
  org_id: number
  platform: string
  bot_token: string | null
  /**
   * The shared secret, decrypted. For a Google Chat integration that has not
   * paired yet this carries the pending /connect code so the settings card can
   * display it; once paired it is null (Google Chat requests are authenticated
   * by Google's signed token, not a shared secret).
   */
  bot_secret: string | null
  /** Google Chat: the pending one-time /connect code, or null when none is active. */
  pairing_code: string | null
  pairing_code_expires_at: string | null
  bot_username: string | null
  channel_ids: string | null
  guild_channel_map: string | null
  connected_guild_id: string | null
  team_id: string | null
  webhook_secret: string | null
  webhook_registered_at: string | null
  escalation_role_id: string | null
  confidence_threshold: number | null
  enabled: number
  auto_deflect_enabled: number
  email_send_method: string
  created_at: string
  updated_at: string
}

function toIntegration(row: typeof integrations.$inferSelect): Integration {
  return {
    id: row.id,
    org_id: row.orgId,
    platform: row.platform,
    bot_token: row.botToken,
    bot_secret: row.botSecretEnc ?? row.botSecret,
    pairing_code: row.pairingCodeEnc,
    pairing_code_expires_at: row.pairingCodeExpiresAt ?? null,
    bot_username: row.botUsername ?? null,
    channel_ids: row.channelIds,
    guild_channel_map: row.guildChannelMap ?? null,
    connected_guild_id: row.connectedGuildId ?? null,
    team_id: row.teamId,
    webhook_secret: row.webhookSecret,
    webhook_registered_at: row.webhookRegisteredAt ?? null,
    escalation_role_id: row.escalationRoleId ?? null,
    confidence_threshold: row.confidenceThreshold ?? 0.8,
    enabled: row.enabled,
    auto_deflect_enabled: row.autoDeflectEnabled,
    email_send_method: row.emailSendMethod,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function pairingCodeIsActive(row: { pairing_code: string | null; pairing_code_expires_at: string | null }): boolean {
  return !!row.pairing_code && !!row.pairing_code_expires_at && row.pairing_code_expires_at > new Date().toISOString()
}

function decryptRow(row: Integration): Integration {
  const pairingCode = row.pairing_code ? decryptToken(row.pairing_code) : null
  const isPendingGoogleChat = row.platform === 'google_chat' && !row.team_id
  const active = pairingCodeIsActive({ pairing_code: pairingCode, pairing_code_expires_at: row.pairing_code_expires_at })
  return {
    ...row,
    bot_token: row.bot_token ? decryptToken(row.bot_token) : null,
    webhook_secret: row.webhook_secret ? decryptToken(row.webhook_secret) : null,
    bot_secret: isPendingGoogleChat
      ? (active ? pairingCode : null)
      : row.bot_secret ? decryptToken(row.bot_secret) : null,
    pairing_code: active ? pairingCode : null,
  }
}

/**
 * Rows written before bot_secret_enc existed still hold the secret in the
 * legacy plaintext column (the migration hashes them but cannot encrypt). The
 * first read re-stores the value encrypted and clears the plaintext. A failure
 * here (for example no ENCRYPTION_KEY configured) is non-fatal: the legacy
 * value keeps working until the next read.
 */
async function upgradeLegacySecret(row: typeof integrations.$inferSelect): Promise<typeof integrations.$inferSelect> {
  if (!row.botSecret || row.botSecretEnc) return row
  try {
    const enc = encryptToken(row.botSecret)
    const hash = hashBotSecret(row.botSecret)
    await getDb()
      .update(integrations)
      .set({ botSecretEnc: enc, botSecretHash: hash, botSecret: null })
      .where(and(eq(integrations.id, row.id), isNull(integrations.botSecretEnc)))
    return { ...row, botSecretEnc: enc, botSecretHash: hash, botSecret: null }
  } catch (err) {
    logger.warn('could not re-encrypt legacy integration secret', { module: MOD, integrationId: row.id, error: err })
    return row
  }
}

async function hydrate(row: typeof integrations.$inferSelect): Promise<Integration> {
  return decryptRow(toIntegration(await upgradeLegacySecret(row)))
}

export async function getIntegration(orgId: number, platform: Platform): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, platform)))
    .limit(1)
  return row ? hydrate(row) : null
}

/**
 * Resolve the enabled integration that owns a presented shared secret. The
 * caller must say which platform(s) the secret is valid for: a secret minted
 * for one channel never authenticates a request meant for another. Google
 * Chat has no shared secret and can never match here.
 *
 * Matching is by SHA-256 digest only. Migration 0047 recorded the digest for
 * every row that held a legacy plaintext secret, and every write since stores
 * it, so no row needs a plaintext comparison. A row that still carries the
 * legacy plaintext column is upgraded to the encrypted copy when it is read.
 */
export async function getIntegrationByBotSecret(
  botSecret: string,
  platform: Platform | readonly Platform[]
): Promise<Integration | null> {
  if (!botSecret) return null
  const platforms = (Array.isArray(platform) ? platform : [platform]).filter((p) => p !== 'google_chat')
  if (platforms.length === 0) return null
  const hash = hashBotSecret(botSecret)
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.botSecretHash, hash),
        inArray(integrations.platform, platforms as Platform[]),
        eq(integrations.enabled, 1)
      )
    )
    .orderBy(asc(integrations.id))
    .limit(1)
  return row ? hydrate(row) : null
}

export async function getIntegrationByGuildId(guildId: string): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.connectedGuildId, guildId),
        eq(integrations.platform, 'discord'),
        eq(integrations.enabled, 1)
      )
    )
    .orderBy(asc(integrations.id))
    .limit(1)
  return row ? hydrate(row) : null
}

/**
 * Resolve the org connected to a Discourse forum. The inbound webhook has no
 * OAuth handshake to learn the org↔site mapping — Discourse sends the forum's
 * base URL in the `X-Discourse-Instance` header on every event, and the org
 * stored that same URL in `teamId` at connect time (the generic-column reuse
 * pattern Slack/Google Chat already follow). The per-webhook HMAC secret is
 * read back from the encrypted `bot_secret_enc` column (surfaced as
 * `bot_secret`). At most one enabled integration can hold a given site (unique
 * partial index); the lowest id wins if legacy data ever disagrees.
 */
export async function getIntegrationByDiscourseSite(siteUrl: string): Promise<Integration | null> {
  const normalized = siteUrl.trim().replace(/\/+$/, '').toLowerCase()
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(
      and(
        sql`lower(${integrations.teamId}) = ${normalized}`,
        eq(integrations.platform, 'discourse'),
        eq(integrations.enabled, 1)
      )
    )
    .orderBy(asc(integrations.id))
    .limit(1)
  return row ? hydrate(row) : null
}

export async function getIntegrationByTeamId(teamId: string): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.teamId, teamId),
        eq(integrations.platform, 'slack'),
        eq(integrations.enabled, 1)
      )
    )
    .orderBy(asc(integrations.id))
    .limit(1)
  return row ? hydrate(row) : null
}

/**
 * Resolve the org connected to a Google Chat space. Unlike Slack/Discord,
 * a Google Chat unlisted app has no OAuth callback to learn the org↔space
 * mapping at connect time — an org generates a one-time pairing code
 * (issueGoogleChatPairingCode), a Workspace admin adds the app to a space and
 * posts `/connect <code>`, and the events route redeems the code with
 * completeGoogleChatPairing, which stores the space's resourceName here
 * (teamId column reused — same "generic column, platform-specific meaning"
 * pattern Slack's teamId already is).
 */
export async function getIntegrationByGoogleChatSpace(spaceName: string): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.teamId, spaceName),
        eq(integrations.platform, 'google_chat'),
        eq(integrations.enabled, 1)
      )
    )
    .orderBy(asc(integrations.id))
    .limit(1)
  return row ? hydrate(row) : null
}

export type GoogleChatPairingResult =
  | { status: 'paired'; orgId: number }
  | { status: 'invalid' }
  | { status: 'space_in_use' }

/**
 * Redeems a Google Chat /connect code in one atomic UPDATE: the row must still
 * be unpaired, the code must match and be unexpired, and the code columns are
 * cleared in the same statement so a code works exactly once. An integration
 * that is already paired is never touched, and a space that another enabled
 * integration already holds is refused by the unique (platform, team_id) index.
 */
export async function completeGoogleChatPairing(code: string, spaceName: string): Promise<GoogleChatPairingResult> {
  if (!code || !spaceName) return { status: 'invalid' }
  const nowIso = new Date().toISOString()
  try {
    const [row] = await getDb()
      .update(integrations)
      .set({
        teamId: spaceName,
        enabled: 1,
        pairingCodeHash: null,
        pairingCodeEnc: null,
        pairingCodeExpiresAt: null,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(integrations.platform, 'google_chat'),
          eq(integrations.pairingCodeHash, hashBotSecret(code)),
          isNull(integrations.teamId),
          gt(integrations.pairingCodeExpiresAt, nowIso)
        )
      )
      .returning({ orgId: integrations.orgId })
    return row ? { status: 'paired', orgId: row.orgId } : { status: 'invalid' }
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 'space_in_use' }
    throw err
  }
}

/**
 * Issues (or re-shows) the one-time /connect code for an org's Google Chat
 * integration. An unexpired pending code is returned as-is so a double submit
 * cannot invalidate a code the owner already posted; an expired or missing one
 * is replaced. Returns `already_paired` when the org is connected to a space.
 */
export async function issueGoogleChatPairingCode(
  orgId: number,
  newCode: string
): Promise<{ status: 'issued'; code: string } | { status: 'already_paired' }> {
  const existing = await getIntegration(orgId, 'google_chat')
  if (existing?.team_id) return { status: 'already_paired' }
  if (existing?.pairing_code) return { status: 'issued', code: existing.pairing_code }

  const values = {
    pairingCodeHash: hashBotSecret(newCode),
    pairingCodeEnc: encryptToken(newCode),
    pairingCodeExpiresAt: new Date(Date.now() + GOOGLE_CHAT_PAIRING_TTL_MS).toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (existing) {
    await getDb()
      .update(integrations)
      .set({ ...values, enabled: 0 })
      .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, 'google_chat')))
  } else {
    await getDb().insert(integrations).values({ orgId, platform: 'google_chat', enabled: 0, ...values })
  }
  return { status: 'issued', code: newCode }
}

export async function listIntegrations(orgId: number): Promise<Integration[]> {
  const rows = await getDb()
    .select()
    .from(integrations)
    .where(eq(integrations.orgId, orgId))
    .orderBy(integrations.platform)
  return Promise.all(rows.map((r) => hydrate(r)))
}

/**
 * Every org's active Slack integration, not just one org's — for the bot's
 * poller org list, which has to cover every tenant, not a single hardcoded
 * workspace. listIntegrations(orgId) is scoped to exactly one org (correct
 * for its actual callers, all of which already have an orgId in hand); it is
 * not a substitute for this.
 */
export async function listActiveSlackIntegrations(): Promise<Pick<Integration, 'org_id' | 'bot_token' | 'channel_ids'>[]> {
  const rows = await getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.platform, 'slack'), eq(integrations.enabled, 1)))
    .orderBy(asc(integrations.id))
  return rows
    .map((r) => decryptRow(toIntegration(r)))
    .filter((i) => !!i.bot_token)
}

export async function upsertIntegration(input: {
  orgId: number
  platform: Platform
  botToken?: string | null
  botSecret?: string | null
  botUsername?: string | null
  channelIds?: string[]
  connectedGuildId?: string | null
  teamId?: string | null
  webhookSecret?: string | null
  escalationRoleId?: string | null
  confidenceThreshold?: number | null
  // Automatic Deflections — default OFF (undefined here leaves the column
  // at its existing/DB-default value; only an explicit true/false updates
  // it, same guard style as confidenceThreshold above).
  autoDeflectEnabled?: boolean
  // 'platform' | 'oauth' | 'domain' — see integrations.emailSendMethod's
  // schema doc comment. undefined leaves the column at its existing value.
  emailSendMethod?: 'platform' | 'oauth' | 'domain'
  // Defaults to true. Set false only for a pending Google Chat pairing —
  // the row exists (to hold the pairing code) but isn't a live connection
  // until /connect succeeds (completeGoogleChatPairing flips this to true).
  enabled?: boolean
}): Promise<Integration> {
  const channelIdsJson = input.channelIds ? JSON.stringify(input.channelIds) : null
  const encryptedBotToken = input.botToken ? encryptToken(input.botToken) : null
  const encryptedWebhookSecret = input.webhookSecret ? encryptToken(input.webhookSecret) : null
  const secretColumns = input.botSecret
    ? { botSecret: null, botSecretEnc: encryptToken(input.botSecret), botSecretHash: hashBotSecret(input.botSecret) }
    : null

  const existing = await getIntegration(input.orgId, input.platform)
  // A Google Chat row that has not paired yet stays disabled until /connect
  // succeeds; saving its other settings must not switch it on.
  const isUnpairedGoogleChat = input.platform === 'google_chat' && !!existing && !existing.team_id
  const enabled = input.enabled === undefined ? (isUnpairedGoogleChat ? 0 : 1) : input.enabled ? 1 : 0

  if (existing) {
    await getDb()
      .update(integrations)
      .set({
        botToken: encryptedBotToken ?? undefined,
        ...(secretColumns ?? {}),
        botUsername: input.botUsername !== undefined ? (input.botUsername ?? null) : undefined,
        channelIds: channelIdsJson ?? undefined,
        connectedGuildId: input.connectedGuildId !== undefined ? (input.connectedGuildId ?? null) : undefined,
        teamId: input.teamId ?? undefined,
        webhookSecret: encryptedWebhookSecret ?? undefined,
        // A new token invalidates any prior setWebhook call (Telegram's
        // getWebhookInfo is keyed to the token), so clear the confirmed
        // "registered" state and require Register webhook again.
        webhookRegisteredAt: encryptedBotToken ? null : undefined,
        escalationRoleId: input.escalationRoleId !== undefined ? (input.escalationRoleId ?? null) : undefined,
        confidenceThreshold: input.confidenceThreshold !== undefined ? (input.confidenceThreshold ?? 0.8) : undefined,
        autoDeflectEnabled: input.autoDeflectEnabled !== undefined ? (input.autoDeflectEnabled ? 1 : 0) : undefined,
        emailSendMethod: input.emailSendMethod ?? undefined,
        enabled,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(integrations.orgId, input.orgId), eq(integrations.platform, input.platform)))
    return (await getIntegration(input.orgId, input.platform))!
  }

  const [row] = await getDb()
    .insert(integrations)
    .values({
      orgId: input.orgId,
      platform: input.platform,
      botToken: encryptedBotToken,
      botSecret: null,
      botSecretEnc: secretColumns?.botSecretEnc ?? null,
      botSecretHash: secretColumns?.botSecretHash ?? null,
      botUsername: input.botUsername ?? null,
      channelIds: channelIdsJson,
      connectedGuildId: input.connectedGuildId ?? null,
      teamId: input.teamId ?? null,
      webhookSecret: encryptedWebhookSecret ?? null,
      escalationRoleId: input.escalationRoleId ?? null,
      confidenceThreshold: input.confidenceThreshold ?? 0.8,
      autoDeflectEnabled: input.autoDeflectEnabled ? 1 : 0,
      emailSendMethod: input.emailSendMethod ?? 'platform',
      enabled,
    })
    .returning()

  return hydrate(row)
}

export async function markTelegramWebhookRegistered(orgId: number): Promise<void> {
  await getDb()
    .update(integrations)
    .set({ webhookRegisteredAt: new Date().toISOString() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, 'telegram')))
}

export async function disableIntegration(orgId: number, platform: Platform): Promise<void> {
  await getDb()
    .update(integrations)
    .set({ enabled: 0, updatedAt: new Date().toISOString() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, platform)))
}

export async function deleteIntegration(orgId: number, platform: Platform): Promise<void> {
  await getDb()
    .delete(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, platform)))
}

export function parseChannelIds(integration: Integration): string[] {
  if (!integration.channel_ids) return []
  try {
    return JSON.parse(integration.channel_ids) as string[]
  } catch {
    return []
  }
}

/** Returns a map of { channelId → guildId } built from the bot's connected guilds. */
export function parseGuildChannelMap(integration: Integration): Record<string, string> {
  if (!integration.guild_channel_map) return {}
  try {
    return JSON.parse(integration.guild_channel_map) as Record<string, string>
  } catch {
    return {}
  }
}

export async function saveGuildChannelMap(
  orgId: number,
  map: Record<string, string>
): Promise<void> {
  await getDb()
    .update(integrations)
    .set({ guildChannelMap: JSON.stringify(map), updatedAt: new Date().toISOString() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, 'discord')))
}
