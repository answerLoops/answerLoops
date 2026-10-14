import { NextRequest } from 'next/server'
import { getIntegrationByBotSecret, parseChannelIds } from '@/lib/db/queries/integrations'
import { getTicketBySourceMessageInChannel } from '@/lib/db/queries/tickets'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { clampIngestContent, isIngestRateLimited, WEBHOOK_MAX_BODY_BYTES } from '@/lib/ingest/limits'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { telegramSourceMessageId } from '@/lib/telegram/message-id'
import { logger } from '@/lib/logger'

const MOD = 'api/telegram/webhook'

interface TelegramUser {
  id: number
  first_name: string
  username?: string
  is_bot?: boolean
}

interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  text?: string
  date: number
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export async function POST(req: NextRequest) {
  // Telegram sends the secret we registered via setWebhook's secret_token param.
  // We store it as the integration's shared secret so we can identify the org.
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token')
  if (!secretToken) {
    logger.warn('Telegram webhook received without secret token', { module: MOD })
    return new Response('Unauthorized', { status: 401 })
  }

  const integration = await getIntegrationByBotSecret(secretToken, 'telegram')
  if (!integration) {
    logger.warn('Telegram webhook secret did not match any org', { module: MOD })
    return new Response('Unauthorized', { status: 401 })
  }

  const orgId = integration.org_id
  const monitoredChatIds = parseChannelIds(integration)

  if (await isIngestRateLimited(orgId)) {
    return new Response('Too Many Requests', { status: 429 })
  }

  const raw = await readBodyCapped(req, WEBHOOK_MAX_BODY_BYTES)
  if (raw === null) return new Response('Payload Too Large', { status: 413 })

  let update: TelegramUpdate
  try {
    update = JSON.parse(raw) as TelegramUpdate
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const message = update.message
  if (!message?.text || !message.from) {
    // Non-text update (sticker, photo, etc.) — acknowledge and ignore
    return Response.json({ ok: true })
  }

  // Ignore bot messages
  if (message.from.is_bot) return Response.json({ ok: true })

  const chatId = String(message.chat.id)

  // Filter: if chat IDs are configured, only process those chats
  if (monitoredChatIds.length > 0 && !monitoredChatIds.includes(chatId)) {
    return Response.json({ ok: true })
  }

  if (message.text.trim().length < 10) return Response.json({ ok: true })

  // Telegram message ids repeat across chats, so new tickets are keyed by
  // chat + message. A ticket stored under the bare message id (created before
  // that format) still counts as the same message.
  const legacyMessageId = String(message.message_id)
  const legacy = await getTicketBySourceMessageInChannel(legacyMessageId, chatId, orgId)
  if (legacy) {
    logger.debug('duplicate Telegram message — matches a legacy ticket', { module: MOD, ticketId: legacy.id })
    return Response.json({ ok: true })
  }

  logger.info('Telegram message received', {
    module: MOD,
    orgId,
    chatId,
    messageId: message.message_id,
    chatType: message.chat.type,
  })

  await processCommunityMessage(
    {
      messageId: telegramSourceMessageId(chatId, message.message_id),
      content: clampIngestContent(message.text),
      authorId: String(message.from.id),
      authorName: message.from.username ?? message.from.first_name,
      channelId: chatId,
      platform: 'telegram',
    },
    orgId
  )

  return Response.json({ ok: true })
}
