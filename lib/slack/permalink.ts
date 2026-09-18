import { logger } from '../logger'

const MOD = 'slack-permalink'

/**
 * Resolves a message's permalink via Slack's chat.getPermalink API.
 * Needs the bot token and channel+ts while the message is fresh in hand —
 * unlike Discord/Telegram/GitHub, a working Slack URL can't be derived from
 * stored IDs alone at render time (it needs the workspace's vanity domain,
 * which we never store). Returns null on any failure — a missing permalink
 * degrades to no link shown, never blocks ticket creation.
 */
export async function getSlackPermalink(
  botToken: string,
  channelId: string,
  messageTs: string
): Promise<string | null> {
  try {
    const url = new URL('https://slack.com/api/chat.getPermalink')
    url.searchParams.set('channel', channelId)
    url.searchParams.set('message_ts', messageTs)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as { ok: boolean; permalink?: string; error?: string }

    if (!data.ok || !data.permalink) {
      logger.warn('chat.getPermalink failed', { module: MOD, channelId, error: data.error })
      return null
    }
    return data.permalink
  } catch (err) {
    logger.warn('chat.getPermalink request failed', { module: MOD, channelId, error: err })
    return null
  }
}
