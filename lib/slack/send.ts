import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getIntegration } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'

const MOD = 'slack/send'
const SLACK_API = 'https://slack.com/api'

async function resolveToken(orgId: number): Promise<string | null> {
  const integration = await getIntegration(orgId, 'slack')
  return integration?.bot_token ?? null
}

export async function sendToSlackChannel(
  channelId: string,
  content: string,
  orgId: number,
  // Set only when replying inside an existing thread. Slack's chat.postMessage
  // needs the real channel id in `channel` PLUS this as a separate field —
  // unlike Discord, a Slack thread has no postable id of its own that can
  // stand in for the channel. Passing a thread's ts as if it were the
  // channel (the bug this parameter fixes) fails with channel_not_found.
  threadTs?: string
): Promise<string | null> {
  if (MOCK_EXTERNALS) {
    return `mock-slack-${channelId}`
  }

  const token = await resolveToken(orgId)
  if (!token) {
    logger.warn('no bot token — skipping send', { module: MOD, orgId })
    return null
  }

  // Slack messages max 3000 chars per block — split if needed
  const chunks = splitMessage(content)
  let lastTs: string | null = null

  for (const text of chunks) {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
      signal: AbortSignal.timeout(10_000),
    })

    const data = await res.json() as { ok: boolean; ts?: string; error?: string }
    if (!data.ok) {
      logger.error('chat.postMessage failed', { module: MOD, channelId, orgId, slackError: data.error })
      return null
    }
    lastTs = data.ts ?? null
  }

  return lastTs
}

function splitMessage(content: string, maxLen = 2990): string[] {
  if (content.length <= maxLen) return [content]
  const chunks: string[] = []
  let remaining = content
  while (remaining.length > maxLen) {
    const splitAt = remaining.lastIndexOf('\n', maxLen) || maxLen
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt)
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
