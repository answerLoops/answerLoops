import { logger } from '@/lib/logger'

const MOD = 'telegram/webhook'
const TELEGRAM_API = 'https://api.telegram.org'

export interface RegisterResult {
  ok: boolean
  webhookUrl: string
  error?: string
}

/**
 * Point a Telegram bot's webhook at this deployment's `/api/telegram/webhook`
 * endpoint. Called both from the manual "Register webhook" button and
 * automatically from saveTelegramIntegrationAction, so a freshly connected bot
 * receives updates without a second manual step.
 *
 * `secretToken` is echoed back by Telegram in the `X-Telegram-Bot-Api-Secret-Token`
 * header on every delivery; the webhook route checks it against the stored
 * bot_secret.
 */
export async function registerTelegramWebhook(
  botToken: string,
  secretToken: string,
  baseUrl: string,
): Promise<RegisterResult> {
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook`

  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
  if (!res.ok || !data.ok) {
    logger.warn('telegram setWebhook failed', { module: MOD, status: res.status, description: data.description })
    return { ok: false, webhookUrl, error: data.description ?? 'Telegram API error' }
  }

  return { ok: true, webhookUrl }
}
