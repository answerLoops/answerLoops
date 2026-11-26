import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Automatic Deflections switch is a checkbox, so a form submitted with it
// off carries no value for it at all. Every card that saves the switch must
// read that as "off", or a channel that once had deflections on can never be
// switched back to drafts held for review.

const h = vi.hoisted(() => ({
  upsertIntegration: vi.fn(),
  getIntegration: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: vi.fn(async () => ({ ok: true, orgId: 5 })) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({
  upsertIntegration: h.upsertIntegration,
  deleteIntegration: vi.fn(),
  getIntegration: h.getIntegration,
  issueGoogleChatPairingCode: vi.fn(),
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => true) }))
vi.mock('@/lib/db/queries/discord-guilds', () => ({ updateDiscordGuildChannels: vi.fn(), removeDiscordGuild: vi.fn() }))
vi.mock('@/lib/db/queries/email-domains', () => ({
  getEmailDomain: vi.fn(async () => null), upsertEmailDomain: vi.fn(), updateEmailDomainStatus: vi.fn(), deleteEmailDomain: vi.fn(),
}))
vi.mock('@/lib/email/domain', () => ({ registerDomain: vi.fn(), checkDomainStatus: vi.fn(), removeDomain: vi.fn() }))
vi.mock('@/lib/db/queries/email-oauth', () => ({ getEmailOauthConnection: vi.fn(async () => null), deleteEmailOauthConnection: vi.fn() }))
vi.mock('@/lib/email/gmail', () => ({ revokeGmailToken: vi.fn() }))
vi.mock('@/lib/email/outlook', () => ({ revokeOutlookToken: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))
vi.mock('@/lib/telegram/webhook', () => ({ registerTelegramWebhook: vi.fn(async () => ({ ok: true })) }))

const connected = {
  bot_token: 'stored-token',
  bot_secret: 'stored-secret',
  bot_username: 'answers',
  team_id: 'https://forum.example.com',
  channel_ids: [],
  enabled: 1,
  auto_deflect_enabled: 1,
}

type Save = (prev: unknown, fd: FormData) => Promise<unknown>

const cards: Array<[string, string, Record<string, string>]> = [
  ['saveDiscourseIntegrationAction', 'discourse', { siteUrl: 'https://forum.example.com', apiKey: '', botUsername: 'answers' }],
  ['saveTelegramIntegrationAction', 'telegram', { botToken: '', chatIds: '-100123' }],
  ['saveEmailIntegrationAction', 'email', { allowedSenders: '' }],
]

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  fd.set('confidenceThreshold', '0.8')
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TELEGRAM_WEBHOOK_BASE_URL', '')
  vi.stubEnv('AUTH_URL', '')
  h.getIntegration.mockResolvedValue(connected)
})

describe('saving a card with Automatic Deflections switched off', () => {
  it.each(cards)('%s saves deflections as off when the switch is off', async (name, platform, fields) => {
    const actions = (await import('@/lib/actions/integrations')) as unknown as Record<string, Save>
    const result = await actions[name](null, form(fields))
    expect(result === null || !(result as { error?: string }).error, JSON.stringify(result)).toBe(true)
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ platform, autoDeflectEnabled: false }))
  })

  it.each(cards)('%s saves deflections as on when the switch is on', async (name, platform, fields) => {
    const actions = (await import('@/lib/actions/integrations')) as unknown as Record<string, Save>
    await actions[name](null, form({ ...fields, autoDeflectEnabled: 'on' }))
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ platform, autoDeflectEnabled: true }))
  })
})
