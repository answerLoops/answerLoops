import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getIntegration } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'

const MOD = 'telegram/send'
const TELEGRAM_API = 'https://api.telegram.org'

// Telegram message limit is 4096 chars; leave headroom for formatting.
const MAX_CHUNK = 4000

function splitMessage(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > MAX_CHUNK) {
    const splitAt = remaining.lastIndexOf('\n', MAX_CHUNK) || MAX_CHUNK
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export async function sendToTelegramChat(
  chatId: string,
  content: string,
  orgId: number,
  replyToMessageId?: string
): Promise<string | null> {
  if (MOCK_EXTERNALS) return `mock-tg-${chatId}`

  const integration = await getIntegration(orgId, 'telegram')
  const token = integration?.bot_token ?? process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    logger.warn('no Telegram bot token — skipping send', { module: MOD, orgId })
    return null
  }

  const chunks = splitMessage(content)
  let lastMessageId: string | null = null

  for (let i = 0; i < chunks.length; i++) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'Markdown',
    }
    // Only reply to the original on the first chunk
    if (i === 0 && replyToMessageId) {
      body.reply_to_message_id = Number(replyToMessageId)
    }

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const err = await res.text()
      logger.error('failed to send Telegram message', { module: MOD, chatId, orgId, status: res.status, err })
      return null
    }

    const data = await res.json() as { result?: { message_id: number } }
    lastMessageId = String(data.result?.message_id ?? '')
  }

  return lastMessageId
}
