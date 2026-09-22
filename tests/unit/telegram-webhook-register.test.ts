import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { registerTelegramWebhook } from '@/lib/telegram/webhook'

// The Telegram connect flow used to save the token and stop — the webhook had
// to be registered later from a separate button on the Settings card, so the
// integration showed "connected" while receiving nothing. saveTelegramInteg-
// rationAction now calls registerTelegramWebhook itself.

describe('registerTelegramWebhook', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('calls setWebhook with the deployment URL, a secret token, and message-only updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await registerTelegramWebhook('123:ABC', 'sekret', 'https://app.example.com/')
    expect(res).toEqual({ ok: true, webhookUrl: 'https://app.example.com/api/telegram/webhook' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:ABC/setWebhook')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      url: 'https://app.example.com/api/telegram/webhook',
      secret_token: 'sekret',
      allowed_updates: ['message'],
      drop_pending_updates: true,
    })
    vi.unstubAllGlobals()
  })

  it('returns ok:false with Telegram\'s description when the API rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, description: 'Bad Request: bad webhook: HTTPS url must be provided' }),
    }))
    const res = await registerTelegramWebhook('123:ABC', 'sekret', 'http://localhost:3000')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/HTTPS url/)
    vi.unstubAllGlobals()
  })
})

describe('saveTelegramIntegrationAction wiring', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/actions/integrations.ts'), 'utf-8')

  it('registers the webhook after the upsert, gated on a token + AUTH_URL, not blocking the save', () => {
    const fn = src.slice(src.indexOf('export async function saveTelegramIntegrationAction'))
    const body = fn.slice(0, fn.indexOf('\nexport '))
    expect(body).toContain('registerTelegramWebhook(effectiveToken, botSecret, baseUrl)')
    expect(body).toContain('process.env.AUTH_URL')
    // failure returns a warning, not an error, so onboarding still advances
    expect(body).toMatch(/return \{ warning:/)
    const upsertIdx = body.indexOf('upsertIntegration({')
    const registerIdx = body.indexOf('registerTelegramWebhook(')
    expect(upsertIdx).toBeGreaterThan(-1)
    expect(registerIdx).toBeGreaterThan(upsertIdx)
  })

  it('the /api/telegram/register route shares the same helper', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/telegram/register/route.ts'), 'utf-8')
    expect(route).toContain("import { registerTelegramWebhook } from '@/lib/telegram/webhook'")
    expect(route).toContain('registerTelegramWebhook(integration.bot_token, integration.bot_secret, baseUrl)')
  })
})
