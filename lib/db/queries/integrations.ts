import { eq, and } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { integrations } from '../schema'
import { encryptToken, decryptToken } from '@/lib/crypto/tokens'

export type Platform = 'discord' | 'slack' | 'telegram' | 'email' | 'google_chat' | 'discourse' | 'circle'

export interface Integration {
  id: number
  org_id: number
  platform: string
  bot_token: string | null
  bot_secret: string | null
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
    bot_secret: row.botSecret,
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

function decryptRow(row: Integration): Integration {
  return {
    ...row,
    bot_token: row.bot_token ? decryptToken(row.bot_token) : null,
    webhook_secret: row.webhook_secret ? decryptToken(row.webhook_secret) : null,
  }
}

export async function getIntegration(orgId: number, platform: Platform): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, platform)))
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
}

export async function getIntegrationByBotSecret(botSecret: string): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.botSecret, botSecret), eq(integrations.enabled, 1)))
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
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
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
}

/**
 * Resolve the org connected to a Discourse forum. The inbound webhook has no
 * OAuth handshake to learn the org↔site mapping — Discourse sends the forum's
 * base URL in the `X-Discourse-Instance` header on every event, and the org
 * stored that same URL in `teamId` at connect time (the generic-column reuse
 * pattern Slack/Google Chat already follow). The per-webhook HMAC secret lives
 * in `botSecret` (raw, not encrypted) so the signature can be checked against
 * this row without a decrypt step.
 */
export async function getIntegrationByDiscourseSite(siteUrl: string): Promise<Integration | null> {
  const normalized = siteUrl.replace(/\/+$/, '')
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.teamId, normalized),
        eq(integrations.platform, 'discourse'),
        eq(integrations.enabled, 1)
      )
    )
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
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
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
}

/**
 * Resolve the org connected to a Google Chat space. Unlike Slack/Discord,
 * a Google Chat unlisted app has no OAuth callback to learn the org↔space
 * mapping at connect time — an org generates a one-time pairing code
 * (upsertIntegration with enabled: false), a Workspace admin adds the app to
 * a space and posts `/connect <code>`, and the events route resolves the
 * code via getIntegrationByPairingCode and stores the space's resourceName
 * here (teamId column reused — same "generic column, platform-specific
 * meaning" pattern Slack's teamId already is).
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
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
}

/**
 * Resolve a not-yet-paired Google Chat integration by its one-time pairing
 * code. Deliberately does not filter on `enabled` — the row is created with
 * enabled: false and only flips to enabled: true once pairing succeeds, so
 * filtering on enabled here would make pairing impossible.
 */
export async function getIntegrationByPairingCode(code: string): Promise<Integration | null> {
  const [row] = await getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.botSecret, code), eq(integrations.platform, 'google_chat')))
    .limit(1)
  return row ? decryptRow(toIntegration(row)) : null
}

/** Marks a pending Google Chat pairing as complete once /connect succeeds. */
export async function completeGoogleChatPairing(orgId: number, spaceName: string): Promise<void> {
  await getDb()
    .update(integrations)
    .set({ teamId: spaceName, enabled: 1, updatedAt: new Date().toISOString() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.platform, 'google_chat')))
}

export async function listIntegrations(orgId: number): Promise<Integration[]> {
  const rows = await getDb()
    .select()
    .from(integrations)
    .where(eq(integrations.orgId, orgId))
    .orderBy(integrations.platform)
  return rows.map((r) => decryptRow(toIntegration(r)))
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
  const enabled = input.enabled === false ? 0 : 1

  const existing = await getIntegration(input.orgId, input.platform)
  if (existing) {
    await getDb()
      .update(integrations)
      .set({
        botToken: encryptedBotToken ?? undefined,
        botSecret: input.botSecret ?? undefined,
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
      botSecret: input.botSecret ?? null,
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

  return decryptRow(toIntegration(row))
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
