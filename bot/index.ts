import postgres from 'postgres'
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  Partials,
  MessageReaction,
  PartialMessageReaction,
  PartialMessage,
  User,
  PartialUser,
  ChatInputCommandInteraction,
  AnyThreadChannel,
} from 'discord.js'
import {
  forwardMessage,
  forwardReaction,
  type BotConfig,
  type IncomingMessage,
  type IncomingReaction,
} from './handlers'
import { registerSlashCommands, handleAsk, handleSummarize, type SlashConfig } from './slash'
import { logger } from '../lib/logger'
import { getIntegration, listActiveSlackIntegrations, parseChannelIds, saveGuildChannelMap } from '../lib/db/queries/integrations'
import { getDiscordGuildByGuildId, parseDiscordGuildChannelIds } from '../lib/db/queries/discord-guilds'
import { markDiscordDeleted, markThreadDiscordDeleted } from '../lib/db/queries/tickets'
import { DEFAULT_ORG_ID } from '../lib/db/schema'
import { startSlackPoller, reloadSlackPoller, stopSlackPoller } from '../lib/slack/poller'
import { getOrgsPendingPurge, hardPurgeOrg } from '../lib/db/queries/orgs'
import { getStuckPendingTickets } from '../lib/db/queries/tickets'
import { claimNextKbSyncJob, reclaimStuckKbSyncJobs } from '../lib/db/queries/kb-sync-jobs'
import { getDirectDatabaseUrl } from '../lib/db/direct-url'
import { getDeploymentMode } from '../lib/billing/plans'
import { getOrgIdsWithFlag } from '../lib/db/queries/feature-flags'

const MOD = 'bot'

// How often to check for orgs whose 30-day deletion grace period has
// elapsed. Deletion is rare and the check itself is a single indexed query,
// so a coarse interval is plenty — this only needs to run at all, not fast.
const ORG_PURGE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

function startOrgPurgeSweep(): void {
  const sweep = async () => {
    let orgIds: number[]
    try {
      orgIds = await getOrgsPendingPurge()
    } catch (err) {
      logger.error('org purge sweep: failed to list pending orgs', { module: MOD, error: err })
      return
    }
    for (const orgId of orgIds) {
      try {
        await hardPurgeOrg(orgId)
        logger.warn('org hard-purged after grace period elapsed', { module: MOD, orgId })
      } catch (err) {
        // One org's purge failing must not block the rest, and must not
        // crash the bot process — it'll retry on the next sweep.
        logger.error('org purge sweep: failed to purge org', { module: MOD, orgId, error: err })
      }
    }
  }
  sweep().catch(() => {})
  setInterval(() => { sweep().catch(() => {}) }, ORG_PURGE_SWEEP_INTERVAL_MS)
}

// Safety net for GitHub issue #222: a ticket's after()-scheduled background
// job (embedding, AI draft, notifications) has been observed to silently
// never run for some messages under rapid concurrent ingestion — no error
// logged anywhere, no way to detect it from inside the request that
// scheduled it. Runs from the bot process, not the Next.js app, because
// next/server's after() can only be scheduled from within a real Next.js
// request — this deliberately forwards over HTTP to a dedicated app route
// instead of importing the pipeline in-process, the same reason the Slack
// poller forwards to /api/ingest rather than calling processCommunityMessage
// directly (see lib/slack/poller.ts).
const STUCK_TICKET_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const STUCK_TICKET_THRESHOLD_MINUTES = 5

function startStuckTicketSweep(): void {
  const targetUrl = process.env.BOT_TARGET_URL ?? 'http://localhost:3000'
  const botSecret = process.env.BOT_SECRET

  const sweep = async () => {
    if (!botSecret) return // retry-stuck route requires BOT_SECRET; nothing to do without it

    let candidates: { id: number; org_id: number }[]
    try {
      candidates = await getStuckPendingTickets(STUCK_TICKET_THRESHOLD_MINUTES)
    } catch (err) {
      logger.error('stuck ticket sweep: failed to list candidates', { module: MOD, error: err })
      return
    }

    for (const { id, org_id } of candidates) {
      try {
        const res = await fetch(`${targetUrl}/api/ingest/retry-stuck`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botSecret}` },
          body: JSON.stringify({ ticket_id: id, org_id }),
        })
        if (!res.ok) {
          logger.warn('stuck ticket sweep: retry request failed', { module: MOD, ticketId: id, status: res.status })
        }
      } catch (err) {
        // One ticket's retry failing must not block the rest, and must not
        // crash the bot process — it'll retry on the next sweep.
        logger.error('stuck ticket sweep: failed to retry ticket', { module: MOD, ticketId: id, error: err })
      }
    }
  }
  sweep().catch(() => {})
  setInterval(() => { sweep().catch(() => {}) }, STUCK_TICKET_SWEEP_INTERVAL_MS)
}

// KB sync worker. Notion/GitHub KB syncs are enqueued into kb_sync_jobs (by the
// "Sync now" buttons and the GitHub push webhook) instead of running inline in
// those requests. This sweep claims queued jobs and drives each one via
// POST /api/kb/sync-jobs/run — same discover-claim-forward shape as the stuck
// ticket sweep above, and for the same reason: the sync work needs a real app
// request context (embeddings, KB queries) and must not run in the bot process
// itself.
//
// Driven by NOTIFY, not by this interval: a kb_sync_jobs trigger fires
// pg_notify('kb_sync_job_queued', id) on every enqueue and requeue (see
// lib/db/migrate.ts), delivered over the same LISTEN connection as
// config_changed/member_joined/data_changed — see watchNotifications below.
// This interval is only a safety net for a notification that got dropped
// (network blip on the LISTEN connection between disconnect and reconnect)
// or a job stuck in `running` from a worker crash. It used to be the only
// trigger, polling unconditionally every 15 seconds — on Neon-style
// serverless Postgres that kept the database compute from ever
// autosuspending, running up compute-hour billing for no work being done.
const KB_SYNC_SAFETY_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const KB_SYNC_STUCK_THRESHOLD_MS = 15 * 60 * 1000
const KB_SYNC_MAX_ATTEMPTS = 3
const KB_SYNC_JOBS_PER_TICK = 3

/**
 * Starts the KB sync worker's safety-net interval and returns a `trigger`
 * function to run the same sweep immediately (called from the
 * kb_sync_job_queued NOTIFY handler) plus a `stop` function for shutdown.
 * A running/pending guard collapses a burst of NOTIFYs (several jobs
 * enqueued back to back) into a single extra pass rather than overlapping
 * concurrent sweeps against the same claim query.
 */
function startKbSyncSweep(): { trigger: () => void; stop: () => void } {
  const targetUrl = process.env.BOT_TARGET_URL ?? 'http://localhost:3000'
  const botSecret = process.env.BOT_SECRET
  let running = false
  let pending = false

  const sweep = async () => {
    if (!botSecret) return // the run route requires BOT_SECRET; nothing to do without it
    if (running) { pending = true; return }
    running = true

    try {
      try {
        const reclaimed = await reclaimStuckKbSyncJobs(KB_SYNC_STUCK_THRESHOLD_MS, KB_SYNC_MAX_ATTEMPTS)
        if (reclaimed > 0) logger.warn('kb sync sweep: reclaimed stuck jobs', { module: MOD, count: reclaimed })
      } catch (err) {
        logger.error('kb sync sweep: reclaim failed', { module: MOD, error: err })
      }

      for (let i = 0; i < KB_SYNC_JOBS_PER_TICK; i++) {
        let job: Awaited<ReturnType<typeof claimNextKbSyncJob>>
        try {
          job = await claimNextKbSyncJob()
        } catch (err) {
          logger.error('kb sync sweep: claim failed', { module: MOD, error: err })
          return
        }
        if (!job) return

        try {
          const res = await fetch(`${targetUrl}/api/kb/sync-jobs/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botSecret}` },
            body: JSON.stringify({ jobId: job.id }),
          })
          if (!res.ok) {
            logger.warn('kb sync sweep: run request failed', { module: MOD, jobId: job.id, status: res.status })
          }
        } catch (err) {
          // A failed forward leaves the job `running`; the reclaim above requeues
          // it on a later tick. One job failing must not stop the rest.
          logger.error('kb sync sweep: failed to drive job', { module: MOD, jobId: job.id, error: err })
        }
      }
    } finally {
      running = false
      if (pending) {
        pending = false
        sweep().catch(() => {})
      }
    }
  }

  sweep().catch(() => {})
  const timer = setInterval(() => { sweep().catch(() => {}) }, KB_SYNC_SAFETY_SWEEP_INTERVAL_MS)
  return {
    trigger: () => { sweep().catch(() => {}) },
    stop: () => clearInterval(timer),
  }
}

// How often to ping the dedicated LISTEN connection. Two jobs: (1) on Neon
// and similar serverless Postgres, any query keeps the whole compute from
// auto-suspending on idle (the default is ~5 minutes) — a suspend silently
// kills every connection on it, LISTEN included; (2) a network path can also
// drop a long-idle TCP connection on its own (proxies, load balancers) without
// a clean close, which postgres.js's own onclose-based reconnect never sees.
// A periodic query on this exact connection surfaces that failure quickly
// instead of leaving the bot silently deaf to every NOTIFY until it's
// manually restarted — this is what actually happened in production: the
// connection went stale after ~30 minutes idle and every config change after
// that was missed with nothing in the logs to explain why.
const LISTEN_HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000

/**
 * Opens a dedicated single connection for LISTEN/NOTIFY and keeps it alive,
 * dispatching each channel's notifications to its own handler. Pooled
 * connections cannot be used for LISTEN — the notification arrives on
 * whichever connection Postgres chooses, so we need one stable connection
 * shared across every channel the bot cares about (config_changed,
 * member_joined, data_changed, kb_sync_job_queued) rather than one
 * connection per channel. Manages the raw connection directly (rather than
 * postgres.js's `.listen()` sugar, which opens its own hidden internal
 * connection reconnected only on a clean `close` event) so a heartbeat can
 * run on the exact socket LISTEN uses, and a failed heartbeat triggers an
 * immediate reconnect+re-LISTEN (re-subscribing every channel). Returns a
 * cleanup function that stops the heartbeat and closes the connection on
 * shutdown.
 */
function watchNotifications(handlers: Record<string, (payload: string) => Promise<void> | void>): () => Promise<void> {
  const url = getDirectDatabaseUrl()
  if (!url) {
    logger.warn('DATABASE_URL not set — realtime hot-reload disabled', { module: MOD })
    return () => Promise.resolve()
  }
  const channels = Object.keys(handlers)

  let stopped = false
  let current: ReturnType<typeof postgres> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // Ending the old connection as part of our own reconnect also fires that
  // connection's onclose — without this guard, that stray callback would
  // schedule a second, redundant reconnect on top of the one already in
  // flight. Each connect() call owns one epoch; a callback only acts if it's
  // still the current epoch, so a replaced connection's late-arriving
  // onclose/heartbeat-failure is silently ignored instead of double-firing.
  let epoch = 0

  const scheduleReconnect = (forEpoch: number, reason: string, err?: unknown) => {
    if (stopped || forEpoch !== epoch || reconnectTimer) return
    logger.warn('LISTEN connection lost — reconnecting', { module: MOD, reason, error: err })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 2000)
  }

  const connect = () => {
    if (stopped) return
    const myEpoch = ++epoch
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
    current?.end({ timeout: 0 }).catch(() => {})

    // `onnotify` isn't in postgres.js's public Options<T> TS type, but it's a
    // real runtime option — the library's own `sql.listen()` sugar
    // (node_modules/postgres/src/index.js) uses this exact mechanism
    // internally to receive NOTIFY payloads. Declared explicitly here rather
    // than cast with `any` so the rest of the options object stays checked.
    const options: postgres.Options<{}> & { onnotify: (channel: string, payload: string) => void } = {
      max: 1,
      max_lifetime: null,
      onnotify: (channel, payload) => {
        const handler = handlers[channel]
        if (!handler) return
        Promise.resolve(handler(payload)).catch((err) =>
          logger.warn(`${channel} notification handler failed`, { module: MOD, error: err })
        )
      },
      onclose: () => scheduleReconnect(myEpoch, 'connection closed'),
    }
    const sql = postgres(url, options)
    current = sql

    sql.unsafe(channels.map((c) => `LISTEN ${c}`).join('; '))
      .then(() => {
        // A newer connect() may have already taken over (its onclose fired
        // and triggered a reconnect) before this LISTEN promise settled.
        // Every other completion path here is epoch-guarded via
        // scheduleReconnect — this one must be too, or it clobbers the
        // real heartbeat with one polling an already-superseded connection.
        if (myEpoch !== epoch) return
        logger.info('LISTEN active', { module: MOD, channels })
        heartbeat = setInterval(() => {
          sql.unsafe('SELECT 1').catch((err) => scheduleReconnect(myEpoch, 'heartbeat failed', err))
        }, LISTEN_HEARTBEAT_INTERVAL_MS)
      })
      .catch((err) => {
        logger.warn('LISTEN setup failed', { module: MOD, error: err })
        scheduleReconnect(myEpoch, 'initial LISTEN failed', err)
      })
  }

  connect()

  return async () => {
    stopped = true
    if (heartbeat) clearInterval(heartbeat)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    await current?.end()
  }
}

/** Builds { channelId → guildId } from all guilds the bot is currently in. */
function buildGuildChannelMap(guilds: Map<string, { channels: { cache: Map<string, unknown> } }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [guildId, guild] of guilds) {
    for (const channelId of guild.channels.cache.keys()) {
      map[channelId] = guildId
    }
  }
  return map
}

// Per-guild config cache for multi-tenant routing.
// Maps guildId → per-org BotConfig (or null if no org has that guild connected).
// Cleared whenever a config_changed LISTEN/NOTIFY fires so fresh DB values are
// picked up without a bot restart.
const guildConfigCache = new Map<string, { config: BotConfig; orgId: number } | null>()

function clearGuildConfigCache() {
  guildConfigCache.clear()
  logger.info('per-guild config cache cleared', { module: MOD })
}

/** Resolve per-org config for a specific guildId. Falls back to null if unconfigured. */
async function loadOrgConfigForGuild(guildId: string): Promise<{ config: BotConfig; orgId: number } | null> {
  if (guildConfigCache.has(guildId)) return guildConfigCache.get(guildId)!

  const targetUrl = process.env.BOT_TARGET_URL ?? 'http://localhost:3000'
  let guildRow: Awaited<ReturnType<typeof getDiscordGuildByGuildId>>
  try {
    guildRow = await getDiscordGuildByGuildId(guildId)
  } catch (err) {
    // A DB error here is not "this guild has no org" — caching that
    // conflation as `null` would silently stop message forwarding for an
    // already-configured guild until the next config_changed reload (itself
    // unreliable without DIRECT_DATABASE_URL — see lib/db/direct-url.ts).
    // Leave the guild unresolved for THIS lookup only; don't poison the cache.
    logger.error('failed to resolve Discord guild config — DB lookup error, not treating as unconfigured', {
      module: MOD, guildId, error: err,
    })
    return null
  }

  let result: { config: BotConfig; orgId: number } | null = null
  if (guildRow) {
    // botSecret is shared per org across every guild that org connects —
    // resolve it from the org's integrations row, not the per-guild row.
    let orgIntegration: Awaited<ReturnType<typeof getIntegration>> = null
    try {
      orgIntegration = await getIntegration(guildRow.org_id, 'discord')
    } catch (err) {
      logger.error('failed to resolve org Discord integration — DB lookup error, not treating as unconfigured', {
        module: MOD, guildId, orgId: guildRow.org_id, error: err,
      })
      return null
    }
    result = {
      orgId: guildRow.org_id,
      config: {
        targetUrl,
        botSecret: orgIntegration?.bot_secret ?? process.env.BOT_SECRET ?? '',
        channelIds: parseDiscordGuildChannelIds(guildRow),
      },
    }
  }

  guildConfigCache.set(guildId, result)
  return result
}

async function loadConfig(): Promise<{
  discordToken: string
  config: BotConfig
  slashConfig: SlashConfig
}> {
  const targetUrl = process.env.BOT_TARGET_URL ?? 'http://localhost:3000'
  let dbIntegration: Awaited<ReturnType<typeof getIntegration>> = null
  let dbLookupFailed = false
  try {
    dbIntegration = await getIntegration(DEFAULT_ORG_ID, 'discord')
  } catch (err) {
    // Falling back to env vars here is correct for "no DB row configured",
    // but wrong for "DB is momentarily unreachable" — the two look identical
    // downstream unless logged distinctly. See lib/db/direct-url.ts: a
    // pooled DATABASE_URL without DIRECT_DATABASE_URL set can flap the
    // LISTEN connection, and this fallback previously masked that as a
    // silent, unlogged "config reloaded — channel list changed".
    dbLookupFailed = true
    logger.error('failed to load Discord integration from database — falling back to environment variables', {
      module: MOD, error: err,
    })
  }

  const discordToken = (dbIntegration?.bot_token ?? process.env.DISCORD_TOKEN) || ''
  const botSecret = (dbIntegration?.bot_secret ?? process.env.BOT_SECRET) || ''
  const channelIds = dbIntegration
    ? parseChannelIds(dbIntegration)
    : (process.env.DISCORD_CHANNEL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  if (dbIntegration) {
    logger.info('loaded Discord config from database', { module: MOD, channelCount: channelIds.length })
  } else if (!dbLookupFailed) {
    logger.info('loaded Discord config from environment variables', { module: MOD, channelCount: channelIds.length })
  }
  // else: already logged as an error above — don't also log the env-var
  // fallback as if it were the expected, intentional path.

  return {
    discordToken,
    config: { targetUrl, botSecret, channelIds },
    slashConfig: { targetUrl, botSecret },
  }
}

async function main() {
  const initial = await loadConfig()

  if (!initial.discordToken) {
    logger.error('No Discord token found — set it in Settings → Integrations or DISCORD_TOKEN env var', { module: MOD })
    process.exit(1)
  }

  if (!process.env.DISCORD_APPLICATION_ID) {
    logger.warn('DISCORD_APPLICATION_ID not set — slash commands will not be registered', { module: MOD })
  }

  if (initial.config.channelIds.length === 0) {
    logger.warn('No channel IDs configured — bot will not forward any messages. Set them in Settings → Integrations.', { module: MOD })
  }

  // Mutable ref — event handlers read from this on every invocation so
  // config changes (channels, thresholds, bot secret) apply without restart.
  // The Discord token cannot be hot-swapped (already logged in); a token
  // change requires a bot restart.
  const live = {
    config: initial.config,
    slashConfig: initial.slashConfig,
  }

  // client is declared below — capture via closure after it's assigned
  let clientRef: Client | null = null

  async function reloadConfig() {
    const fresh = await loadConfig().catch(() => null)
    if (!fresh) return
    const prev = live.config.channelIds.join(',')
    const next = fresh.config.channelIds.join(',')
    live.config = fresh.config
    live.slashConfig = fresh.slashConfig
    // Invalidate per-guild cache so new channel/secret values are used immediately.
    clearGuildConfigCache()
    if (prev !== next) {
      logger.info('config reloaded — channel list changed', {
        module: MOD,
        channelCount: fresh.config.channelIds.length,
      })
    }
  }

  async function refreshGuildMap() {
    if (!clientRef?.isReady()) return
    const guildMap = buildGuildChannelMap(
      clientRef.guilds.cache as unknown as Map<string, { channels: { cache: Map<string, unknown> } }>
    )
    await saveGuildChannelMap(DEFAULT_ORG_ID, guildMap).catch(() => null)
  }

  // Self-hosted deployments poll every org unconditionally — we can't tell
  // from our side whether a given self-hoster actually has their own Events
  // API subscription live, so polling stays a safe universal fallback there
  // (see the docs' reasoning on public-URL constraints). On cloud, every org
  // already gets real-time delivery via the Events API webhook
  // (app/api/slack/events, handled by the app service directly) — polling
  // only runs for orgs with the 'slack_force_polling' flag set in
  // org_feature_flags, a manual per-contract override (set internally, never
  // self-serve) for enterprise Slack admins who require an outbound-only
  // integration regardless of who hosts the webhook receiver.
  async function loadSlackOrgIds(): Promise<number[]> {
    try {
      const all = await listActiveSlackIntegrations()
      const allOrgIds = all.map((i) => i.org_id)
      if (getDeploymentMode() === 'self-hosted') return allOrgIds
      const flagged = await getOrgIdsWithFlag(allOrgIds, 'slack_force_polling')
      return allOrgIds.filter((id) => flagged.has(id))
    } catch {
      return []
    }
  }

  const kbSyncSweep = startKbSyncSweep()

  // Replace polling with Postgres LISTEN/NOTIFY — fires instantly when the
  // integrations table is written from the settings UI, or a kb_sync_jobs
  // row is enqueued/requeued.
  // Do NOT call refreshGuildMap() from the config_changed handler:
  // saveGuildChannelMap() writes to integrations, which fires config_changed
  // again → infinite loop. Guild map updates happen only on ClientReady and
  // GuildCreate.
  const stopListening = watchNotifications({
    config_changed: async () => {
      await reloadConfig()
      // loadSlackOrgIds already returns the mode/flag-aware list — always
      // safe to reload regardless of deployment mode.
      const orgIds = await loadSlackOrgIds()
      reloadSlackPoller(orgIds)
    },
    kb_sync_job_queued: () => { kbSyncSweep.trigger() },
  })

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      stopSlackPoller()
      kbSyncSweep.stop()
      await stopListening()
      process.exit(0)
    })
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    // Reactions arrive on messages the bot didn't cache (e.g. an AI answer posted
    // via the REST API), so we must opt into partials to receive those events.
    partials: [Partials.Message, Partials.Reaction],
  })
  clientRef = client

  // The client can go silently deaf to gateway events (a zombie WebSocket
  // connection, a shard dropped without a clean disconnect) while `client`
  // still reports as logged in and every DB-side config still looks correct
  // — nothing else in this file would ever notice or log that, which cost
  // real debugging time chasing config/DB explanations for what turned out
  // to be a connection health problem. discord.js normally auto-reconnects,
  // but we had no visibility into whether that was even happening.
  client.on(Events.Error, (err) => {
    logger.error('Discord client error', { module: MOD, error: err })
  })
  client.on(Events.ShardError, (err, shardId) => {
    logger.error('Discord shard error', { module: MOD, shardId, error: err })
  })
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn('Discord shard disconnected', { module: MOD, shardId, code: event.code, reason: event.reason })
  })
  client.on(Events.ShardReconnecting, (shardId) => {
    logger.warn('Discord shard reconnecting', { module: MOD, shardId })
  })
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    logger.info('Discord shard resumed', { module: MOD, shardId, replayedEvents })
  })
  client.on(Events.Warn, (message) => {
    logger.warn('Discord client warning', { module: MOD, message })
  })

  client.once(Events.ClientReady, async (c) => {
    logger.info(`logged in as ${c.user.tag}`, {
      module: MOD,
      channelCount: live.config.channelIds.length,
      targetUrl: live.config.targetUrl,
    })

    const applicationId = process.env.DISCORD_APPLICATION_ID
    if (applicationId) {
      await registerSlashCommands(
        initial.discordToken,
        applicationId,
        process.env.DISCORD_GUILD_ID
      )
    }

    // Auto-discover which guild owns each channel so source links work
    // for old tickets (before per-message guild_id capture was added).
    const guildMap = buildGuildChannelMap(c.guilds.cache as unknown as Map<string, { channels: { cache: Map<string, unknown> } }>)
    await saveGuildChannelMap(DEFAULT_ORG_ID, guildMap).catch((err) =>
      logger.warn('failed to save guild channel map', { module: MOD, error: err })
    )
    logger.info('guild channel map saved', { module: MOD, guildCount: c.guilds.cache.size })

    // Ground truth for "can this process actually receive events here" —
    // cheaper and more reliable than reading Discord's permission UI by
    // hand. A guild or channel missing from this dump means Discord isn't
    // giving the bot visibility into it at all, no matter what Settings or
    // the discord_guilds table say, and no error would ever surface that on
    // its own — a silently-denied channel just never generates an event.
    for (const [guildId, guild] of c.guilds.cache) {
      logger.debug('guild visibility at startup', {
        module: MOD,
        guildId,
        guildName: guild.name,
        channelIds: [...guild.channels.cache.keys()],
      })
    }
  })

  client.on(Events.MessageCreate, async (message: Message) => {
    // Multi-tenant: look up per-org config by guild. Falls back to live.config
    // for single-org (env-var) deployments where no org has a connected guild.
    const orgCfg = message.guildId
      ? await loadOrgConfigForGuild(message.guildId)
      : null
    const cfg = orgCfg?.config ?? live.config
    const result = await forwardMessage(message as unknown as IncomingMessage, cfg)
    if (result.data?.duplicate) {
      logger.debug('duplicate message skipped', { module: MOD, messageId: message.id })
    } else if (result.data?.appended) {
      logger.info('thread reply appended to existing ticket', {
        module: MOD,
        ticketId: result.data.ticket_id,
        messageId: message.id,
        orgId: orgCfg?.orgId,
      })
    } else if (result.data?.ticket_id) {
      logger.info('ticket created', {
        module: MOD,
        ticketId: result.data.ticket_id,
        messageId: message.id,
        orgId: orgCfg?.orgId,
      })
    }
  })

  // Forum posts fire ThreadCreate (not MessageCreate) — the starter message
  // is the thread's initial post content. Replies inside the thread fire
  // MessageCreate with channel.isThread() === true, which isMonitored() already handles.
  client.on(Events.ThreadCreate, async (thread: AnyThreadChannel, newlyCreated: boolean) => {
    if (!newlyCreated) return
    if (!thread.parentId) return
    const guildId = thread.guildId
    const orgCfg = guildId ? await loadOrgConfigForGuild(guildId) : null
    const cfg = orgCfg?.config ?? live.config
    if (!cfg.channelIds.includes(thread.parentId)) return

    let starterMessage: Message | null = null
    try {
      starterMessage = await thread.fetchStarterMessage()
    } catch (err) {
      logger.warn('failed to fetch forum starter message', { module: MOD, threadId: thread.id, error: err })
      return
    }
    if (!starterMessage) return

    const incomingMsg: IncomingMessage = {
      id: starterMessage.id,
      content: starterMessage.content,
      channelId: thread.id,
      guildId: guildId ?? null,
      author: { bot: starterMessage.author.bot, id: starterMessage.author.id, username: starterMessage.author.username },
      channel: { isThread: () => true, parentId: thread.parentId },
    }
    const result = await forwardMessage(incomingMsg, cfg)
    if (result.data?.duplicate) {
      logger.debug('duplicate forum post skipped', { module: MOD, threadId: thread.id })
    } else if (result.data?.ticket_id) {
      logger.info('ticket created from forum post', {
        module: MOD,
        ticketId: result.data.ticket_id,
        threadId: thread.id,
        orgId: orgCfg?.orgId,
      })
    }
  })

  client.on(
    Events.MessageReactionAdd,
    async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
      const guildId = (reaction.message as { guildId?: string | null }).guildId ?? null
      const orgCfg = guildId
        ? await loadOrgConfigForGuild(guildId)
        : null
      const cfg = orgCfg?.config ?? live.config
      const result = await forwardReaction(reaction as unknown as IncomingReaction, user, cfg)
      if (result.data?.ticket_id) {
        logger.info('feedback recorded', { module: MOD, ticketId: result.data.ticket_id, userId: user.id })
      }
    }
  )

  // Keep guild→channel map current when bot joins or leaves a server.
  client.on(Events.GuildCreate, async () => {
    await refreshGuildMap()
    logger.info('joined new guild — guild channel map updated', { module: MOD })
  })

  client.on(Events.GuildDelete, async () => {
    await refreshGuildMap()
    logger.info('left guild — guild channel map updated', { module: MOD })
  })

  client.on(Events.MessageDelete, async (message: Message | PartialMessage) => {
    if (!message.id) return
    await markDiscordDeleted(message.id).catch((err) =>
      logger.warn('failed to mark message deleted', { module: MOD, messageId: message.id, error: err })
    )
    logger.info('discord message deleted — ticket source marked', { module: MOD, messageId: message.id })
  })

  client.on(Events.ThreadDelete, async (thread) => {
    await markThreadDiscordDeleted(thread.id).catch((err) =>
      logger.warn('failed to mark thread deleted', { module: MOD, threadId: thread.id, error: err })
    )
    logger.info('discord thread deleted — ticket source marked', { module: MOD, threadId: thread.id })
  })

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return
    const cmd = interaction as ChatInputCommandInteraction

    logger.info('slash command received', { module: MOD, command: cmd.commandName, userId: cmd.user.id })

    if (cmd.commandName === 'ask') {
      await handleAsk(cmd, live.slashConfig)
    } else if (cmd.commandName === 'summarize') {
      await handleSummarize(cmd, live.slashConfig)
    }
  })

  // loadSlackOrgIds returns the mode/flag-aware org list — every org on
  // self-hosted, and only orgs with the slack_force_polling flag on cloud
  // (see its definition above). Always safe to start; the list is just
  // empty on cloud unless an enterprise contract needs the override.
  const slackOrgIds = await loadSlackOrgIds()
  startSlackPoller(slackOrgIds)

  // Independent of both Discord and Slack — runs regardless of which
  // channels an org has configured. kbSyncSweep was already started above,
  // before the LISTEN connection, so its `trigger` exists when the
  // kb_sync_job_queued handler is wired.
  startOrgPurgeSweep()
  startStuckTicketSweep()

  client.login(initial.discordToken)
}

main().catch((err) => {
  logger.error('bot failed to start', { module: MOD, error: err })
  process.exit(1)
})
