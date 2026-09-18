import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getIntegrationByBotSecret, parseChannelIds } from '@/lib/db/queries/integrations'
import { getDb } from '@/lib/db/drizzle'
import { integrations } from '@/lib/db/schema'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
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
  // We store this as the integration's bot_secret so we can identify the org.
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token')
  if (!secretToken) {
    logger.warn('Telegram webhook received without secret token', { module: MOD })
    return new Response('Unauthorized', { status: 401 })
  }

  const integration = await getIntegrationByBotSecret(secretToken)
  if (!integration || integration.platform !== 'telegram') {
    // TEMPORARY diagnostic — never logs full secret values, only length/
    // prefix, to compare what Telegram sent against what's actually stored
    // for every telegram-platform row. Remove once the 401 mismatch is
    // root-caused.
    const rows = await getDb()
      .select({ orgId: integrations.orgId, botSecret: integrations.botSecret, enabled: integrations.enabled })
      .from(integrations)
      .where(eq(integrations.platform, 'telegram'))
    logger.warn('Telegram webhook secret did not match any org', {
      module: MOD,
      receivedLength: secretToken.length,
      receivedPrefix: secretToken.slice(0, 6),
      receivedSuffix: secretToken.slice(-6),
      storedRows: rows.map((r) => ({
        orgId: r.orgId,
        enabled: r.enabled,
        secretLength: r.botSecret?.length ?? null,
        secretPrefix: r.botSecret?.slice(0, 6) ?? null,
        secretSuffix: r.botSecret?.slice(-6) ?? null,
      })),
    })
    return new Response('Unauthorized', { status: 401 })
  }

  const orgId = integration.org_id
  const monitoredChatIds = parseChannelIds(integration)

  let update: TelegramUpdate
  try {
    update = await req.json() as TelegramUpdate
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

  logger.info('Telegram message received', {
    module: MOD,
    orgId,
    chatId,
    messageId: message.message_id,
    chatType: message.chat.type,
  })

  await processCommunityMessage(
    {
      messageId: String(message.message_id),
      content: message.text,
      authorId: String(message.from.id),
      authorName: message.from.username ?? message.from.first_name,
      channelId: chatId,
      platform: 'telegram',
    },
    orgId
  )

  return Response.json({ ok: true })
}
