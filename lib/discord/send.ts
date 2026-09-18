import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getIntegration } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'

const MOD = 'discord/send'

const DISCORD_API = 'https://discord.com/api/v10'

async function resolveToken(orgId: number): Promise<string | null> {
  const integration = await getIntegration(orgId, 'discord')
  return integration?.bot_token ?? process.env.DISCORD_TOKEN ?? null
}

export async function sendToChannel(channelId: string, content: string, orgId: number): Promise<string | null> {
  if (MOCK_EXTERNALS) {
    return `mock-msg-${channelId}`
  }

  const token = await resolveToken(orgId)
  if (!token) {
    logger.warn('no bot token — skipping send', { module: MOD, orgId })
    return null
  }

  const chunks = splitMessage(content)
  let lastMessageId: string | null = null

  for (const chunk of chunks) {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: chunk }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const body = await res.text()
      logger.error('failed to send message', { module: MOD, channelId, orgId, status: res.status, body })
      return null
    }

    const data = await res.json() as { id: string }
    lastMessageId = data.id
  }

  return lastMessageId
}

function splitMessage(content: string, maxLen = 1990): string[] {
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
