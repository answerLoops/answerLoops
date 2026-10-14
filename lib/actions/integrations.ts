'use server'

import crypto from 'crypto'
import { z } from 'zod'
import { refresh } from 'next/cache'
import { requireOrgAccess } from '@/lib/auth/org'
import {
  upsertIntegration,
  deleteIntegration,
  getIntegration,
  issueGoogleChatPairingCode,
} from '@/lib/db/queries/integrations'
import { updateDiscordGuildChannels, removeDiscordGuild } from '@/lib/db/queries/discord-guilds'
import {
  getEmailDomain,
  upsertEmailDomain,
  updateEmailDomainStatus,
  deleteEmailDomain,
} from '@/lib/db/queries/email-domains'
import { registerDomain, checkDomainStatus, removeDomain } from '@/lib/email/domain'
import { getEmailOauthConnection, deleteEmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { revokeGmailToken } from '@/lib/email/gmail'
import { revokeOutlookToken } from '@/lib/email/outlook'
import { registerTelegramWebhook } from '@/lib/telegram/webhook'
import { assertPublicHttpsUrl, UnsafeUrlError } from '@/lib/http/safe-url'
import { generateBotSecret } from '@/lib/ingest/bot-secret'
import { isUniqueViolation } from '@/lib/ingest/db-errors'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { getDeploymentMode, type DeploymentMode } from '@/lib/billing/plans'
import { logger } from '@/lib/logger'

/** Settings is a client component and can't read server env vars directly. */
export async function getCurrentDeploymentMode(): Promise<DeploymentMode> {
  return getDeploymentMode()
}

async function requireFeature(orgId: number, feature: 'discord_integration' | 'slack_integration' | 'google_chat_integration' | 'discourse_integration' | 'circle_integration'): Promise<string | null> {
  if (await orgHasFeature(orgId, feature)) return null
  const requiredPlan = planRequiredFor(feature)
  return `This integration requires the ${requiredPlan[0].toUpperCase()}${requiredPlan.slice(1)} plan or above — upgrade in Billing to connect it.`
}

// Discord bot tokens: base64(snowflake).timestamp.hmac
const DISCORD_TOKEN_RE = /^[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{4,8}\.[A-Za-z0-9_-]{25,50}$/

const DiscordIntegrationSchema = z.object({
  botToken: z.string().optional(),
  escalationRoleId: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).optional(),
  autoDeflectEnabled: z.coerce.boolean().optional(),
})

export async function saveDiscordIntegrationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'discord_integration')
  if (gateError) return { error: gateError }

  const parsed = DiscordIntegrationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { botToken, escalationRoleId, confidenceThreshold, autoDeflectEnabled } = parsed.data

  // channelIds may come as checkboxes (multiple values) or a comma-separated string
  const rawChannelIds = formData.getAll('channelIds')
  const channelIdList = rawChannelIds
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean)

  if (channelIdList.length === 0) return { error: 'At least one channel is required' }

  const existing = await getIntegration(orgId, 'discord')
  const isOAuthConnected = !!existing?.connected_guild_id

  // OAuth-connected orgs use the platform bot — no per-org token needed
  if (!isOAuthConnected) {
    const newToken = botToken?.trim() || null
    if (!newToken && !existing?.bot_token) {
      return { error: 'Bot token is required' }
    }

    if (newToken) {
      if (!DISCORD_TOKEN_RE.test(newToken)) {
        return { error: 'Invalid Discord bot token format' }
      }
      if (!MOCK_EXTERNALS) {
        const verify = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${newToken}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!verify.ok) {
          return { error: 'Discord rejected this token — check it and try again' }
        }
      }
    }

    const botSecret = existing?.bot_secret ?? generateBotSecret()
    await upsertIntegration({
      orgId,
      platform: 'discord',
      botToken: newToken ?? undefined,
      botSecret,
      channelIds: channelIdList,
      escalationRoleId: escalationRoleId?.trim() || null,
      confidenceThreshold: confidenceThreshold ?? null,
      autoDeflectEnabled,
    })
  } else {
    // OAuth path — update channels/settings only, preserve existing guild linkage
    await upsertIntegration({
      orgId,
      platform: 'discord',
      channelIds: channelIdList,
      escalationRoleId: escalationRoleId?.trim() || null,
      confidenceThreshold: confidenceThreshold ?? null,
      autoDeflectEnabled,
    })
  }

  refresh()

  return null
}

export async function deleteDiscordIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  await deleteIntegration(orgId, 'discord')
  refresh()
  return null
}

// Automatic Deflections is one setting per org (integrations.autoDeflectEnabled),
// not per guild — OAuth-connected orgs have no legacy integrations row to
// edit it through (that card is legacy-manual-connect only), so this is the
// only path that can set it for them. Mirrors the bot_secret fallback in
// app/api/discord/callback/route.ts: an OAuth org always has a bot_secret by
// the time it can reach this (the callback ensures one), but generating a
// fresh one here too means flipping this toggle never fails/no-ops for an
// org whose integrations row is missing for any other reason.
export async function updateDiscordAutoDeflectAction(autoDeflectEnabled: boolean): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'discord_integration')
  if (gateError) return { error: gateError }

  const existing = await getIntegration(orgId, 'discord')
  const botSecret = existing?.bot_secret ?? generateBotSecret()
  // upsertIntegration always writes `enabled` (defaulting true when omitted,
  // not "leave as-is" like most of its other fields) — passing the current
  // value explicitly here, rather than leaving it out, keeps this toggle
  // from silently re-enabling a row someone deliberately disabled.
  await upsertIntegration({
    orgId,
    platform: 'discord',
    botSecret,
    autoDeflectEnabled,
    enabled: existing ? existing.enabled === 1 : true,
  })

  refresh()
  return null
}

// ── Discord — multi-server (OAuth-connected guilds) ─────────────────────────

export async function saveDiscordGuildChannelsAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'discord_integration')
  if (gateError) return { error: gateError }

  const guildId = String(formData.get('guildId') ?? '').trim()
  if (!guildId) return { error: 'Missing guild id' }

  const rawChannelIds = formData.getAll('channelIds')
  const channelIdList = rawChannelIds
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
  if (channelIdList.length === 0) return { error: 'At least one channel is required' }

  const escalationRoleId = String(formData.get('escalationRoleId') ?? '').trim() || null

  await updateDiscordGuildChannels(orgId, guildId, channelIdList, escalationRoleId)
  refresh()
  return null
}

export async function removeDiscordGuildAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const guildId = String(formData.get('guildId') ?? '').trim()
  if (!guildId) return { error: 'Missing guild id' }

  await removeDiscordGuild(orgId, guildId)
  refresh()
  return null
}

// ── Slack ─────────────────────────────────────────────────────────────────────

const SlackIntegrationSchema = z.object({
  botToken: z
    .string()
    .min(1, 'Bot token is required')
    .startsWith('xoxb-', 'Slack bot token must start with xoxb-'),
  // Optional in polling mode; required only if using Slack Events API webhooks
  signingSecret: z.string().optional(),
  teamId: z
    .string()
    .regex(/^T[A-Z0-9]{8,}$/, 'Team ID must start with T followed by uppercase letters/numbers'),
  channelIds: z.string().min(1, 'At least one channel ID is required'),
  escalationRoleId: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).optional(),
})

export async function saveSlackIntegrationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; warning?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'slack_integration')
  if (gateError) return { error: gateError }

  const parsed = SlackIntegrationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { botToken, signingSecret, teamId, channelIds, escalationRoleId, confidenceThreshold } = parsed.data
  const channelIdList = channelIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Confirm the token really belongs to the workspace id being claimed.
  if (!MOCK_EXTERNALS) {
    const verified = await verifySlackWorkspace(botToken, teamId)
    if (!verified.ok) return { error: verified.error }
  }

  const { failed } = await joinSlackChannels(botToken, channelIdList)
  const warning = failed.length > 0
    ? `Joined ${channelIdList.length - failed.length}/${channelIdList.length} channels automatically. ` +
      `Private channels need a manual invite in Slack (Channel → Integrations → Add apps): ` +
      failed.map((f) => f.channelId).join(', ')
    : undefined

  // bot_secret authenticates this org's own traffic to /api/ingest (the
  // Slack poller's HTTP forward) — never generated here before, same gap
  // as the OAuth callback. Preserve an existing secret across re-saves,
  // same pattern every other platform's save action already uses.
  const existingIntegration = await getIntegration(orgId, 'slack')
  const botSecret = existingIntegration?.bot_secret ?? generateBotSecret()

  try {
    await upsertIntegration({
      orgId,
      platform: 'slack',
      botToken,
      botSecret,
      webhookSecret: signingSecret ?? null,
      teamId,
      channelIds: channelIdList,
      escalationRoleId: escalationRoleId?.trim() || null,
      confidenceThreshold: confidenceThreshold ?? null,
    })
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'That Slack workspace is already connected to another answerLoops workspace.' }
    throw err
  }

  refresh()
  return warning ? { warning } : null
}

export async function deleteSlackIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  await deleteIntegration(orgId, 'slack')
  refresh()
  return null
}

// Asks Slack (auth.test) which workspace a bot token belongs to, so a workspace
// id typed into the form can only be saved alongside a token from that
// workspace.
async function verifySlackWorkspace(botToken: string, teamId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as { ok: boolean; team_id?: string; error?: string }
    if (!data.ok) return { ok: false, error: 'Slack rejected this bot token — check it and try again' }
    if (data.team_id !== teamId) return { ok: false, error: 'This bot token belongs to a different Slack workspace than the Team ID entered' }
    return { ok: true }
  } catch (err) {
    logger.warn('Slack auth.test request failed', { module: 'actions/integrations', error: err })
    return { ok: false, error: 'Could not reach Slack to verify the bot token — try again' }
  }
}

// Slack never auto-adds a bot to a channel just because a scope was granted
// — a bot has to explicitly call conversations.join (requires the
// channels:join scope). Without this, picking a channel here saved cleanly
// but left the bot outside it every time: the poller's conversations.history
// calls failed with not_in_channel, silently, server-side only, forever —
// the exact "looks configured, does nothing" failure mode this project
// explicitly doesn't want. Private channels can't be auto-joined by a bot
// at all (a hard Slack platform limit, not something to work around) — those
// still need a human /invite, so a failure there is reported, not retried.
export async function joinSlackChannels(
  botToken: string,
  channelIds: string[]
): Promise<{ failed: { channelId: string; error: string }[] }> {
  const failed: { channelId: string; error: string }[] = []

  await Promise.all(
    channelIds.map(async (channelId) => {
      try {
        const res = await fetch('https://slack.com/api/conversations.join', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ channel: channelId }),
          signal: AbortSignal.timeout(10_000),
        })
        const data = await res.json() as { ok: boolean; error?: string }
        if (!data.ok) {
          logger.warn('Slack conversations.join failed', { module: 'actions/integrations', channelId, error: data.error })
          failed.push({ channelId, error: data.error ?? 'unknown_error' })
        }
      } catch (err) {
        logger.warn('Slack conversations.join request failed', { module: 'actions/integrations', channelId, error: err })
        failed.push({ channelId, error: 'network_error' })
      }
    })
  )

  return { failed }
}

export async function saveSlackChannelsAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; warning?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'slack_integration')
  if (gateError) return { error: gateError }

  const channelIds = String(formData.get('channelIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (channelIds.length === 0) return { error: 'Select at least one channel' }

  const escalationRoleId = String(formData.get('escalationRoleId') ?? '').trim() || null
  const confidenceThreshold = parseFloat(String(formData.get('confidenceThreshold') ?? '0.8'))
  const autoDeflectEnabled = formData.get('autoDeflectEnabled') === 'on'

  const existing = await getIntegration(orgId, 'slack')
  let warning: string | undefined
  if (existing?.bot_token) {
    const { failed } = await joinSlackChannels(existing.bot_token, channelIds)
    if (failed.length > 0) {
      warning = `Joined ${channelIds.length - failed.length}/${channelIds.length} channels automatically. ` +
        `Private channels need a manual invite in Slack (Channel → Integrations → Add apps): ` +
        failed.map((f) => f.channelId).join(', ')
    }
  }

  await upsertIntegration({
    orgId,
    platform: 'slack',
    channelIds,
    escalationRoleId,
    confidenceThreshold: isNaN(confidenceThreshold) ? null : confidenceThreshold,
    autoDeflectEnabled,
  })

  refresh()
  return warning ? { warning } : null
}

// ── Telegram ──────────────────────────────────────────────────────────────────

// Telegram bot tokens: {digits}:{alphanumeric+hyphen} e.g. 123456789:AAHdqTcv...
const TELEGRAM_TOKEN_RE = /^\d{8,12}:[A-Za-z0-9_-]{35}$/

const TelegramIntegrationSchema = z.object({
  botToken: z.string().optional(),
  chatIds: z.string().optional(),
  escalationUsername: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).optional(),
  autoDeflectEnabled: z.coerce.boolean().optional(),
})

export async function saveTelegramIntegrationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; warning?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = TelegramIntegrationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { botToken, chatIds, escalationUsername, confidenceThreshold, autoDeflectEnabled } = parsed.data
  const chatIdList = (chatIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const existing = await getIntegration(orgId, 'telegram')

  const newToken = botToken?.trim() || null
  if (!newToken && !existing?.bot_token) {
    return { error: 'Bot token is required' }
  }

  if (newToken) {
    if (!TELEGRAM_TOKEN_RE.test(newToken)) {
      return { error: 'Invalid Telegram bot token format — should be: 123456789:AAHdqTcv...' }
    }
    if (!MOCK_EXTERNALS) {
      const verify = await fetch(`https://api.telegram.org/bot${newToken}/getMe`, { signal: AbortSignal.timeout(10_000) })
      if (!verify.ok) {
        return { error: 'Telegram rejected this token — check it and try again' }
      }
    }
  }

  const botSecret = existing?.bot_secret ?? generateBotSecret()

  await upsertIntegration({
    orgId,
    platform: 'telegram',
    botToken: newToken ?? undefined,
    botSecret,
    channelIds: chatIdList,
    escalationRoleId: escalationUsername?.trim() || null,
    confidenceThreshold: confidenceThreshold ?? null,
    autoDeflectEnabled,
  })

  refresh()

  // Register the webhook automatically so a freshly connected bot actually
  // receives messages — until this runs the integration shows as connected
  // but ingests nothing. A failure here doesn't fail the save (the token is
  // valid and stored); it comes back as a warning the caller can surface,
  // and the manual "Register webhook" button stays as the retry path.
  const effectiveToken = newToken ?? existing?.bot_token ?? null
  const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL ?? process.env.AUTH_URL
  if (effectiveToken && baseUrl && !MOCK_EXTERNALS) {
    const result = await registerTelegramWebhook(effectiveToken, botSecret, baseUrl)
    if (!result.ok) {
      return { warning: `Bot saved, but registering the webhook failed: ${result.error}. Use "Register webhook" in Settings to retry.` }
    }
  }

  return null
}

export async function deleteTelegramIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  await deleteIntegration(orgId, 'telegram')
  refresh()
  return null
}

/**
 * Validates a customer-supplied site URL (https, public host) and returns it in
 * the canonical form stored in team_id: lowercase origin plus any path, without
 * a trailing slash.
 */
async function normalizePublicSiteUrl(
  raw: string,
  label: string,
  example: string
): Promise<{ url: string } | { error: string }> {
  try {
    const parsed = await assertPublicHttpsUrl(raw)
    return { url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') }
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return { error: `${label} must be a public https:// address (e.g. ${example})` }
    }
    throw err
  }
}

// ── Discourse ─────────────────────────────────────────────────────────────────

const DiscourseIntegrationSchema = z.object({
  siteUrl: z.string().optional(),
  apiKey: z.string().optional(),
  botUsername: z.string().optional(),
  categoryIds: z.string().optional(),
  escalationUser: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).optional(),
  autoDeflectEnabled: z.coerce.boolean().optional(),
})

export async function saveDiscourseIntegrationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; webhookUrl?: string; webhookSecret?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'discourse_integration')
  if (gateError) return { error: gateError }

  const parsed = DiscourseIntegrationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { siteUrl, apiKey, botUsername, categoryIds, escalationUser, confidenceThreshold, autoDeflectEnabled } = parsed.data
  const categoryList = (categoryIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const existing = await getIntegration(orgId, 'discourse')

  const rawSiteUrl = siteUrl?.trim().replace(/\/+$/, '') || existing?.team_id || null
  if (!rawSiteUrl) return { error: 'Discourse site URL is required' }
  const siteCheck = await normalizePublicSiteUrl(rawSiteUrl, 'Site URL', 'https://forum.example.com')
  if ('error' in siteCheck) return { error: siteCheck.error }
  const normalizedSiteUrl = siteCheck.url

  const newKey = apiKey?.trim() || null
  if (!newKey && !existing?.bot_token) return { error: 'API key is required' }

  const username = botUsername?.trim() || existing?.bot_username || null
  if (!username) return { error: 'Bot username is required' }

  // The inbound webhook HMAC secret — preserved across re-saves so a saved
  // webhook keeps verifying.
  const botSecret = existing?.bot_secret ?? generateBotSecret()

  try {
    await upsertIntegration({
      orgId,
      platform: 'discourse',
      botToken: newKey ?? undefined,
      botSecret,
      botUsername: username,
      teamId: normalizedSiteUrl,
      channelIds: categoryList,
      escalationRoleId: escalationUser?.trim() || null,
      confidenceThreshold: confidenceThreshold ?? null,
      autoDeflectEnabled,
    })
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'That Discourse site is already connected to another answerLoops workspace.' }
    throw err
  }

  refresh()

  const baseUrl = process.env.AUTH_URL ?? ''
  return { webhookUrl: `${baseUrl}/api/discourse/webhook`, webhookSecret: botSecret }
}

export async function deleteDiscourseIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  await deleteIntegration(orgId, 'discourse')
  refresh()
  return null
}

// ── Circle ────────────────────────────────────────────────────────────────────

const CircleIntegrationSchema = z.object({
  communityUrl: z.string().optional(),
  apiToken: z.string().optional(),
  spaceIds: z.string().optional(),
  escalationUser: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).optional(),
})

export async function saveCircleIntegrationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; webhookUrl?: string; webhookSecret?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'circle_integration')
  if (gateError) return { error: gateError }

  const parsed = CircleIntegrationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { communityUrl, apiToken, spaceIds, escalationUser, confidenceThreshold } = parsed.data
  const spaceList = (spaceIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const existing = await getIntegration(orgId, 'circle')

  const rawCommunityUrl = communityUrl?.trim().replace(/\/+$/, '') || existing?.team_id || null
  if (!rawCommunityUrl) return { error: 'Circle community URL is required' }
  const communityCheck = await normalizePublicSiteUrl(rawCommunityUrl, 'Community URL', 'https://community.example.com')
  if ('error' in communityCheck) return { error: communityCheck.error }
  const normalizedUrl = communityCheck.url

  const newToken = apiToken?.trim() || null
  if (!newToken && !existing?.bot_token) return { error: 'API token is required' }

  // Per-org inbound secret — preserved across re-saves so a saved Workflow
  // keeps authenticating.
  const botSecret = existing?.bot_secret ?? generateBotSecret()

  await upsertIntegration({
    orgId,
    platform: 'circle',
    botToken: newToken ?? undefined,
    botSecret,
    teamId: normalizedUrl,
    channelIds: spaceList,
    escalationRoleId: escalationUser?.trim() || null,
    confidenceThreshold: confidenceThreshold ?? null,
  })

  refresh()

  const baseUrl = process.env.AUTH_URL ?? ''
  return { webhookUrl: `${baseUrl}/api/circle/webhook`, webhookSecret: botSecret }
}

export async function deleteCircleIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  await deleteIntegration(orgId, 'circle')
  refresh()
  return null
}

// ── Email ─────────────────────────────────────────────────────────────────────

const EmailIntegrationSchema = z.object({
  allowedSenders: z.string().optional(),
  escalationEmail: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).optional(),
  autoDeflectEnabled: z.coerce.boolean().optional(),
})

export async function saveEmailIntegrationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; webhookSecret?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = EmailIntegrationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { allowedSenders, escalationEmail, confidenceThreshold, autoDeflectEnabled } = parsed.data

  const senderList = (allowedSenders ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const existing = await getIntegration(orgId, 'email')
  // bot_secret used as the webhook verification secret — stable per org
  const botSecret = existing?.bot_secret ?? generateBotSecret()

  await upsertIntegration({
    orgId,
    platform: 'email',
    botSecret,
    channelIds: senderList,
    escalationRoleId: escalationEmail?.trim() || null,
    confidenceThreshold: confidenceThreshold ?? null,
    autoDeflectEnabled,
  })

  refresh()
  // Return the secret so the UI can display it for webhook configuration
  return { webhookSecret: botSecret }
}

export async function deleteEmailIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const domain = await getEmailDomain(orgId)
  if (domain?.provider_domain_id) await removeDomain(domain.provider_domain_id)
  if (domain) await deleteEmailDomain(orgId)

  await deleteIntegration(orgId, 'email')
  refresh()
  return null
}

// ── Email: verified custom domain (Phase 1 of the email integration redesign) ──

const StartDomainVerificationSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, 'Domain is required')
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i, 'Invalid domain'),
})

export async function startEmailDomainVerificationAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = StartDomainVerificationSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Idempotent on repeat submits — don't re-register an already-registered domain.
  const existing = await getEmailDomain(orgId)
  if (existing?.provider_domain_id) {
    refresh()
    return null
  }

  const domainName = parsed.data.domain.toLowerCase()
  const result = await registerDomain(domainName)
  if ('error' in result) return { error: result.error }

  await upsertEmailDomain({
    orgId,
    domain: domainName,
    providerDomainId: result.providerDomainId,
    dkim: result.dkim,
    returnPath: result.returnPath,
    receiving: result.receiving,
  })

  refresh()
  return null
}

export async function checkEmailDomainVerificationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string; status?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const existing = await getEmailDomain(orgId)
  if (!existing?.provider_domain_id) return { error: 'No domain registered' }

  const { status, error } = await checkDomainStatus(existing.provider_domain_id)
  if (error) return { error }
  await updateEmailDomainStatus(orgId, status)

  // Flip the send path over the moment verification succeeds so reply.ts
  // picks it up without a separate action.
  if (status === 'verified') {
    await upsertIntegration({ orgId, platform: 'email', emailSendMethod: 'domain' })
  }

  refresh()
  return { status }
}

export async function removeEmailDomainAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const existing = await getEmailDomain(orgId)
  if (existing?.provider_domain_id) await removeDomain(existing.provider_domain_id)
  if (existing) await deleteEmailDomain(orgId)

  // Fall back to 'platform' so reply.ts doesn't dead-end on a 'domain'
  // method with no row backing it.
  await upsertIntegration({ orgId, platform: 'email', emailSendMethod: 'platform' })
  refresh()
  return null
}

// ── Email: OAuth send-only mailbox connection (Phases 2/3 of the email integration redesign) ──
// Connect/reconnect is a redirect (app/api/email/gmail|outlook/install +
// callback), not a form action — the provider's consent screen requires a
// real page navigation. Disconnect is the only piece that fits the action
// pattern, and is shared across providers since at most one connection can
// exist per org (email_oauth_connections.orgId is unique).

export async function disconnectOauthAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const existing = await getEmailOauthConnection(orgId)
  if (existing) {
    if (existing.provider === 'outlook') await revokeOutlookToken(existing.refresh_token)
    else await revokeGmailToken(existing.refresh_token)
    await deleteEmailOauthConnection(orgId)
  }

  // Fall back to 'platform' so reply.ts doesn't dead-end on an 'oauth'
  // method with no row backing it.
  await upsertIntegration({ orgId, platform: 'email', emailSendMethod: 'platform' })
  refresh()
  return null
}

// ── Google Chat ───────────────────────────────────────────────────────────────

// Google Chat's unlisted-app model has no OAuth callback like Slack/Discord
// to learn which space belongs to which org — instead an org generates this
// one-time pairing code (single use, expires after 24 hours), a Workspace
// admin adds the app to a Chat space and posts `/connect <code>`, and
// app/api/google-chat/events/route.ts redeems the code and stores the space id
// (see completeGoogleChatPairing).
export async function generateGoogleChatConnectCodeAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string; connectCode?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'google_chat_integration')
  if (gateError) return { error: gateError }

  // Already paired to a space — issuing a new code here would have no
  // legitimate use, and re-pairing must never move a connected integration.
  // Idempotent otherwise: an unexpired pending code is returned as-is, so a
  // double-submit or a stale client can't invalidate a code the user may have
  // already posted into a space.
  const issued = await issueGoogleChatPairingCode(orgId, `gc_${crypto.randomBytes(12).toString('hex')}`)
  if (issued.status === 'already_paired') {
    return { error: 'Google Chat is already connected. Disconnect first to generate a new code.' }
  }

  refresh()
  return { connectCode: issued.code }
}

export async function saveGoogleChatSettingsAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const gateError = await requireFeature(orgId, 'google_chat_integration')
  if (gateError) return { error: gateError }

  const escalationUserId = String(formData.get('escalationUserId') ?? '').trim() || null
  const confidenceThreshold = parseFloat(String(formData.get('confidenceThreshold') ?? '0.8'))
  const autoDeflectEnabled = formData.get('autoDeflectEnabled') === 'on'

  await upsertIntegration({
    orgId,
    platform: 'google_chat',
    escalationRoleId: escalationUserId,
    confidenceThreshold: isNaN(confidenceThreshold) ? null : confidenceThreshold,
    autoDeflectEnabled,
  })

  refresh()
  return null
}

export async function deleteGoogleChatIntegrationAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  await deleteIntegration(orgId, 'google_chat')
  refresh()
  return null
}
