import { sql } from 'drizzle-orm'
import { getDb } from '../db/drizzle'
import { getIntegration, parseChannelIds } from '../db/queries/integrations'
import { isIgnoredSlackSubtype } from './message-filters'
import { getSlackPermalink } from './permalink'
import { getSlackDisplayName } from './user-info'
import { logger } from '../logger'

const MOD = 'slack-poller'

const DEFAULT_INTERVAL_MS = parseInt(process.env.SLACK_POLL_INTERVAL_SECONDS ?? '60', 10) * 1000

interface SlackMessage {
  ts: string
  text?: string
  user?: string
  bot_id?: string
  subtype?: string
  thread_ts?: string
}

// null means "never polled this channel before" — distinct from any real
// timestamp value, including the string '0'. Conflating the two used to
// mean a channel's very first successful poll had no floor at all, so
// conversations.history happily returned up to 100 pre-existing messages
// and ticketed every one of them — a brand-new customer connecting Slack
// would see their community's entire recent history flood in as "new"
// tickets. See pollChannel below for the fix: a first poll seeds the
// cursor to the newest message present right now and tickets nothing,
// exactly like Discord's gateway only ever seeing messages posted after
// the bot joins.
async function getCursor(orgId: number, channelId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db.execute(
    sql`SELECT last_ts FROM slack_poll_cursors WHERE org_id = ${orgId} AND channel_id = ${channelId}`
  ) as unknown as { last_ts: string }[]
  return rows[0]?.last_ts ?? null
}

async function setCursor(orgId: number, channelId: string, ts: string): Promise<void> {
  const db = getDb()
  await db.execute(sql`
    INSERT INTO slack_poll_cursors (org_id, channel_id, last_ts, updated_at)
    VALUES (${orgId}, ${channelId}, ${ts}, now())
    ON CONFLICT (org_id, channel_id) DO UPDATE
      SET last_ts = EXCLUDED.last_ts, updated_at = now()
  `)
}

export async function pollChannel(
  orgId: number,
  channelId: string,
  botToken: string,
  botSecret: string,
  targetUrl: string
): Promise<void> {
  const cursor = await getCursor(orgId, channelId)
  const isFirstPoll = cursor === null

  const url = new URL('https://slack.com/api/conversations.history')
  url.searchParams.set('channel', channelId)
  url.searchParams.set('limit', '100')
  // oldest is exclusive — only fetch messages newer than the cursor. On a
  // first poll there's no cursor yet, so this intentionally fetches
  // whatever Slack returns (up to 100 recent messages) purely to find the
  // current newest ts — none of them get ticketed, see below.
  if (!isFirstPoll) url.searchParams.set('oldest', cursor)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  const data = await res.json() as { ok: boolean; messages?: SlackMessage[]; error?: string }

  if (!data.ok) {
    logger.warn('Slack conversations.history failed', { module: MOD, channelId, error: data.error })
    return
  }

  const rawMessages = data.messages ?? []

  if (isFirstPoll) {
    // Never backfill a channel's pre-existing history into tickets — only
    // messages posted after this point should ever be ingested, matching
    // Discord's gateway (which never sees anything older than the moment
    // the bot joined). Slack returns newest-first, so [0] is the newest;
    // if the channel has no messages at all yet, seed to "now" in Slack's
    // ts format (unix seconds, fractional) so the next poll's oldest bound
    // is still meaningful.
    const seedTs = rawMessages[0]?.ts ?? String(Date.now() / 1000)
    await setCursor(orgId, channelId, seedTs)
    logger.info('Slack first poll — cursor seeded, no history backfilled', { module: MOD, orgId, channelId })
    return
  }

  const messages = rawMessages
    // Ignore bot messages plus genuine noise subtypes (edits, deletions,
    // channel-join announcements) — but NOT a real message that just
    // happens to carry a subtype, like `file_share` (an attached file).
    .filter((m) => !m.bot_id && !isIgnoredSlackSubtype(m.subtype) && m.user && (m.text?.trim().length ?? 0) >= 10)
    // Slack returns newest-first; process oldest-first so cursor advances correctly
    .reverse()

  for (const msg of messages) {
    try {
      // Resolved best-effort — a failed lookup must never block ticket
      // creation, so getSlackPermalink/getSlackDisplayName already swallow
      // their own errors and return null rather than throwing.
      const sourceUrl = await getSlackPermalink(botToken, channelId, msg.ts)
      const displayName = await getSlackDisplayName(botToken, msg.user!)

      // Forward over HTTP to the app's /api/ingest, exactly like Discord's
      // forwardMessage — never call processCommunityMessage directly from
      // the bot process. Its pipeline uses next/server's after(), which
      // throws "called outside a request scope" anywhere other than a real
      // Next.js request — the bot is a plain Node process with no Next.js
      // runtime at all. Found live: every polled Slack message got a ticket
      // created (the part before after()) but the entire background job —
      // notifications, embeddings, duplicate detection, and critically the
      // AI agent draft/deflect step — silently never ran, for every single
      // self-hosted or force-polling org.
      const res = await fetch(`${targetUrl}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botSecret}`,
        },
        body: JSON.stringify({
          message_id: msg.ts,
          content: msg.text!.trim(),
          author_id: msg.user!,
          author_name: displayName ?? msg.user!,
          channel_id: channelId,
          thread_id: msg.thread_ts,
          platform: 'slack',
          source_url: sourceUrl ?? undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        logger.warn('ingest failed for polled Slack message', { module: MOD, ts: msg.ts, status: res.status })
      }
    } catch (err) {
      logger.warn('failed to process polled Slack message', { module: MOD, ts: msg.ts, error: err })
    }
  }

  // Advance cursor to the newest message we saw
  if (messages.length > 0) {
    const newestTs = messages[messages.length - 1].ts
    await setCursor(orgId, channelId, newestTs)
    logger.info('Slack poll complete', { module: MOD, orgId, channelId, newMessages: messages.length })
  }
}

async function pollOrg(orgId: number): Promise<void> {
  const integration = await getIntegration(orgId, 'slack').catch(() => null)
  if (!integration?.bot_token || !integration.bot_secret || integration.enabled !== 1) return

  const channelIds = parseChannelIds(integration)
  if (channelIds.length === 0) return

  const targetUrl = process.env.BOT_TARGET_URL ?? 'http://localhost:3000'

  await Promise.allSettled(
    channelIds.map((id) => pollChannel(orgId, id, integration.bot_token!, integration.bot_secret!, targetUrl))
  )
}

// Active org IDs to poll. Updated when config_changed fires.
let activeOrgIds: number[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let running = false

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    await Promise.allSettled(activeOrgIds.map(pollOrg))
  } finally {
    running = false
  }
}

function schedule(): void {
  timer = setTimeout(async () => {
    await tick().catch((err) => logger.warn('slack poll tick error', { module: MOD, error: err }))
    schedule()
  }, DEFAULT_INTERVAL_MS)
}

export function startSlackPoller(orgIds: number[]): void {
  activeOrgIds = orgIds
  if (timer !== null) return   // already running — just updated the org list
  logger.info('Slack poller started', { module: MOD, intervalMs: DEFAULT_INTERVAL_MS, orgs: orgIds })
  // Run immediately on first start, then on interval
  tick()
    .catch((err) => logger.warn('slack poll initial tick error', { module: MOD, error: err }))
    .finally(schedule)
}

export function reloadSlackPoller(orgIds: number[]): void {
  activeOrgIds = orgIds
  logger.info('Slack poller org list updated', { module: MOD, orgs: orgIds })
}

export function stopSlackPoller(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  logger.info('Slack poller stopped', { module: MOD })
}
