import { logger } from '../lib/logger'

const MOD = 'bot/handlers'

type Vote = 'up' | 'down'

// 👍/👎 emojis the bot treats as feedback votes on an AI answer.
const VOTE_EMOJI: Record<string, Vote> = {
  '👍': 'up',
  '👎': 'down',
}

export function voteFromEmoji(name: string | null | undefined): Vote | null {
  return (name && VOTE_EMOJI[name]) || null
}

export interface BotConfig {
  targetUrl: string
  botSecret: string
  channelIds: string[]
}

export type FetchLike = (url: string, init: RequestInit) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<unknown>
}>

interface IncomingChannel {
  isThread(): boolean
  parentId: string | null
}

export interface IncomingMessage {
  id: string
  content: string
  channelId: string
  guildId: string | null
  author: { bot: boolean; id: string; username: string }
  channel: IncomingChannel
}

export interface IncomingReaction {
  partial: boolean
  emoji: { name: string | null }
  message: { id: string }
  fetch(): Promise<unknown>
}

interface ReactingUser {
  bot: boolean
  id: string
}

/** A message is monitored when it (or its thread parent) is a watched channel. */
function isMonitored(message: IncomingMessage, channelIds: string[]): boolean {
  const parentId = message.channel.isThread() ? message.channel.parentId : null
  return channelIds.includes(message.channelId) || (parentId != null && channelIds.includes(parentId))
}

/** Whether a message should be forwarded to ingest at all. */
function shouldForward(message: IncomingMessage, channelIds: string[]): boolean {
  if (message.author.bot) return false
  if (!isMonitored(message, channelIds)) return false
  // Skip very short messages (likely reactions or quick replies).
  if (message.content.trim().length < 10) return false
  return true
}

/** The /api/ingest body for a message; threads forward under their parent channel. */
function buildIngestPayload(message: IncomingMessage) {
  const isThread = message.channel.isThread()
  return {
    message_id: message.id,
    content: message.content,
    author_id: message.author.id,
    author_name: message.author.username,
    guild_id: message.guildId ?? undefined,
    channel_id: isThread ? message.channel.parentId ?? message.channelId : message.channelId,
    thread_id: isThread ? message.channelId : undefined,
  }
}

const authHeaders = (secret: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${secret}`,
})

interface ForwardResult {
  forwarded: boolean
  ok?: boolean
  data?: { ok: boolean; ticket_id?: number; duplicate?: boolean; appended?: boolean; ignored?: boolean }
}

/** Forward a community message to /api/ingest. No-ops for filtered messages. */
export async function forwardMessage(
  message: IncomingMessage,
  cfg: BotConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<ForwardResult> {
  if (!shouldForward(message, cfg.channelIds)) return { forwarded: false }

  try {
    const res = await fetchImpl(`${cfg.targetUrl}/api/ingest`, {
      method: 'POST',
      headers: authHeaders(cfg.botSecret),
      body: JSON.stringify(buildIngestPayload(message)),
    })
    if (!res.ok) {
      logger.error('ingest failed', { module: MOD, status: res.status, body: await res.text() })
      return { forwarded: true, ok: false }
    }
    const data = (await res.json()) as ForwardResult['data']
    return { forwarded: true, ok: true, data }
  } catch (err) {
    logger.error('failed to forward message', { module: MOD, error: err })
    return { forwarded: true, ok: false }
  }
}

/** Forward a 👍/👎 reaction to /api/feedback. No-ops for non-vote emojis and bots. */
export async function forwardReaction(
  reaction: IncomingReaction,
  user: ReactingUser,
  cfg: BotConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<ForwardResult> {
  if (user.bot) return { forwarded: false }

  const vote = voteFromEmoji(reaction.emoji.name)
  if (!vote) return { forwarded: false }

  // Partial reactions need a fetch to expose the message id.
  if (reaction.partial) {
    try {
      await reaction.fetch()
    } catch (err) {
      logger.error('failed to fetch partial reaction', { module: MOD, error: err })
      return { forwarded: false }
    }
  }

  try {
    const res = await fetchImpl(`${cfg.targetUrl}/api/feedback`, {
      method: 'POST',
      headers: authHeaders(cfg.botSecret),
      body: JSON.stringify({ message_id: reaction.message.id, vote, actor: user.id }),
    })
    if (!res.ok) {
      logger.error('feedback failed', { module: MOD, status: res.status, body: await res.text() })
      return { forwarded: true, ok: false }
    }
    const data = (await res.json()) as ForwardResult['data']
    return { forwarded: true, ok: true, data }
  } catch (err) {
    logger.error('failed to forward reaction', { module: MOD, error: err })
    return { forwarded: true, ok: false }
  }
}
