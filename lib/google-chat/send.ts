import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getGoogleChatAccessToken } from '@/lib/google-chat/auth'
import { logger } from '@/lib/logger'

const MOD = 'google-chat/send'
const CHAT_API = 'https://chat.googleapis.com/v1'

// Google Chat text messages don't document a hard length ceiling as low as
// Slack's 3000-char block limit, but the API does reject very large payloads
// — split at the same conservative threshold Slack uses rather than finding
// Google's real ceiling the hard way in production.
const MAX_MESSAGE_LENGTH = 2990

function splitMessage(content: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
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

/**
 * Posts a reply into a Google Chat space. `spaceName` is the space's
 * resourceName (e.g. `spaces/AAAA...`) — what we store as a ticket's
 * source_channel_id for this platform. `threadName` (a thread resourceName,
 * `spaces/AAAA/threads/BBBB`), when set, replies inside that thread instead
 * of starting a new top-level message — the Google Chat equivalent of
 * Slack's thread_ts.
 */
export async function sendToGoogleChatSpace(
  spaceName: string,
  content: string,
  threadName?: string
): Promise<string | null> {
  if (MOCK_EXTERNALS) {
    return `mock-google-chat-${spaceName}`
  }

  const token = await getGoogleChatAccessToken()
  if (!token) {
    logger.warn('no access token — skipping send', { module: MOD, spaceName })
    return null
  }

  const chunks = splitMessage(content)
  let lastMessageName: string | null = null

  for (const text of chunks) {
    const url = threadName
      ? `${CHAT_API}/${spaceName}/messages?messageReplyOption=REPLY_MESSAGE_OR_FAIL`
      : `${CHAT_API}/${spaceName}/messages`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, ...(threadName ? { thread: { name: threadName } } : {}) }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      logger.error('Chat messages.create failed', { module: MOD, spaceName, status: res.status, errBody })
      return null
    }

    const data = await res.json() as { name?: string }
    lastMessageName = data.name ?? null
  }

  return lastMessageName
}
