// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// saveCircleIntegrationAction: who may save, what the community URL must look
// like (public https on the hosted service; self-hosted installs may use their
// own network), when an Admin API token is required, and that the webhook token an
// owner pasted into their Circle Workflow stays the same across re-saves.

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  upsertIntegration: vi.fn(),
  getIntegration: vi.fn(),
  orgHasFeature: vi.fn(),
  generateBotSecret: vi.fn(() => 'new-webhook-token'),
  lookup: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({
  upsertIntegration: h.upsertIntegration,
  deleteIntegration: vi.fn(),
  getIntegration: h.getIntegration,
  issueGoogleChatPairingCode: vi.fn(),
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/ingest/bot-secret', () => ({ generateBotSecret: h.generateBotSecret }))
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))
vi.mock('@/lib/db/queries/discord-guilds', () => ({ updateDiscordGuildChannels: vi.fn(), removeDiscordGuild: vi.fn() }))
vi.mock('@/lib/db/queries/email-domains', () => ({
  getEmailDomain: vi.fn(async () => null), upsertEmailDomain: vi.fn(), updateEmailDomainStatus: vi.fn(), deleteEmailDomain: vi.fn(),
}))
vi.mock('@/lib/email/domain', () => ({ registerDomain: vi.fn(), checkDomainStatus: vi.fn(), removeDomain: vi.fn() }))
vi.mock('@/lib/db/queries/email-oauth', () => ({ getEmailOauthConnection: vi.fn(async () => null), deleteEmailOauthConnection: vi.fn() }))
vi.mock('@/lib/email/gmail', () => ({ revokeGmailToken: vi.fn() }))
vi.mock('@/lib/email/outlook', () => ({ revokeOutlookToken: vi.fn() }))
vi.mock('@/lib/telegram/webhook', () => ({ registerTelegramWebhook: vi.fn() }))

const admin = { ok: true as const, orgId: 6, userId: 1, role: 'admin' as const }

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

async function save(fields: Record<string, string>) {
  const { saveCircleIntegrationAction } = await import('@/lib/actions/integrations')
  return saveCircleIntegrationAction(null, form(fields))
}

const existing = (over: Record<string, unknown> = {}) => ({
  platform: 'circle', org_id: 6, bot_token: 'stored-api-token', bot_secret: 'saved-webhook-token', team_id: 'https://community.example', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_URL', 'https://app.example')
  vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', '')
  h.requireOrgAccess.mockResolvedValue(admin)
  h.orgHasFeature.mockResolvedValue(true)
  h.getIntegration.mockResolvedValue(null)
  h.lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
})

describe('saveCircleIntegrationAction', () => {
  it('refuses a plain member before reading or writing anything', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const result = await save({ communityUrl: 'https://community.example', apiToken: 'api-token' })
    expect(result).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.getIntegration).not.toHaveBeenCalled()
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it('refuses an org whose plan does not include Circle, naming the plan', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const result = await save({ communityUrl: 'https://community.example', apiToken: 'api-token' })
    expect(h.orgHasFeature).toHaveBeenCalledWith(6, 'circle_integration')
    expect(result?.error).toMatch(/requires the \w+ plan/)
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it('requires a community URL on first save', async () => {
    const result = await save({ apiToken: 'api-token' })
    expect(result).toEqual({ error: 'Circle community URL is required' })
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it.each([
    ['plain http', 'http://community.example'],
    ['a value that is not a URL', 'community'],
  ])('refuses a community URL that is %s on the hosted service', async (_label, communityUrl) => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    const result = await save({ communityUrl, apiToken: 'api-token' })
    expect(result?.error).toMatch(/Community URL must be a public https:\/\/ address/)
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it('refuses a community URL whose host resolves to a private address on the hosted service', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    h.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const result = await save({ communityUrl: 'https://community.example', apiToken: 'api-token' })
    expect(result?.error).toMatch(/Community URL must be a public https:\/\/ address/)
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it('accepts a community URL on the local network for a self-hosted install', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
    h.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    await save({ communityUrl: 'http://circle.internal', apiToken: 'api-token' })
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'http://circle.internal' }))
  })

  it('normalises the community URL to origin and path without trailing slashes or query', async () => {
    await save({ communityUrl: '  https://Community.Example/hub/?ref=nav#top  ', apiToken: 'api-token' })
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'https://community.example/hub' }))
  })

  it('requires an Admin API token on first save', async () => {
    const result = await save({ communityUrl: 'https://community.example', apiToken: '   ' })
    expect(result).toEqual({ error: 'API token is required' })
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it('saves a first connection with a new webhook token and returns the webhook URL', async () => {
    const result = await save({
      communityUrl: 'https://community.example',
      apiToken: ' api-token ',
      spaceIds: ' 12, ,34 ',
      escalationUser: ' sam ',
      confidenceThreshold: '0.7',
    })
    expect(h.upsertIntegration).toHaveBeenCalledWith({
      orgId: 6,
      platform: 'circle',
      botToken: 'api-token',
      botSecret: 'new-webhook-token',
      teamId: 'https://community.example',
      channelIds: ['12', '34'],
      escalationRoleId: null, // Circle has no escalation user; a stale form value is ignored
      confidenceThreshold: 0.7,
      botUsername: null, // blank "post replies as" posts as the token's admin
      teamMemberIds: [],
      autoDeflectEnabled: false,
    })
    expect(result).toEqual({ webhookUrl: 'https://app.example/api/circle/webhook', webhookSecret: 'new-webhook-token' })
  })

  it('keeps the saved webhook token, API token and community URL when re-saved with blanks', async () => {
    h.getIntegration.mockResolvedValue(existing())
    const result = await save({ communityUrl: '', apiToken: '', spaceIds: '5' })
    expect(h.getIntegration).toHaveBeenCalledWith(6, 'circle')
    expect(h.generateBotSecret).not.toHaveBeenCalled()
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({
      botSecret: 'saved-webhook-token',
      botToken: undefined,
      teamId: 'https://community.example',
      channelIds: ['5'],
    }))
    expect(result).toEqual({ webhookUrl: 'https://app.example/api/circle/webhook', webhookSecret: 'saved-webhook-token' })
  })

  it('replaces the API token when a new one is entered on re-save, keeping the webhook token', async () => {
    h.getIntegration.mockResolvedValue(existing())
    await save({ communityUrl: 'https://community.example', apiToken: 'replacement-api-token' })
    expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({
      botToken: 'replacement-api-token',
      botSecret: 'saved-webhook-token',
    }))
  })

  it('still requires an API token on re-save when none was ever stored', async () => {
    h.getIntegration.mockResolvedValue(existing({ bot_token: null }))
    const result = await save({ communityUrl: 'https://community.example' })
    expect(result).toEqual({ error: 'API token is required' })
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  it('refuses a confidence threshold outside 0 to 1', async () => {
    const result = await save({ communityUrl: 'https://community.example', apiToken: 'api-token', confidenceThreshold: '1.5' })
    expect(result?.error).toBeTruthy()
    expect(h.upsertIntegration).not.toHaveBeenCalled()
  })

  describe('replies', () => {
    const base = { communityUrl: 'https://community.example', apiToken: 'api-token' }

    it('saves the "post replies as" member email, trimmed', async () => {
      await save({ ...base, postAsEmail: ' support@example.com ' })
      expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ botUsername: 'support@example.com' }))
    })

    it('refuses a "post replies as" value that is not an email address', async () => {
      const result = await save({ ...base, postAsEmail: 'support-team' })
      expect(result).toEqual({ error: 'Post replies as must be a member’s email address, or blank to post as the admin.' })
      expect(h.upsertIntegration).not.toHaveBeenCalled()
    })

    it('clears the "post replies as" member when the field is left blank', async () => {
      h.getIntegration.mockResolvedValue(existing({ bot_username: 'support@example.com' }))
      await save({ ...base, postAsEmail: '' })
      expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ botUsername: null }))
    })

    it('forgets the member id learned from earlier replies when the "post replies as" member changes', async () => {
      h.getIntegration.mockResolvedValue(existing({ bot_username: 'support@example.com', bot_user_id: '31' }))
      await save({ ...base, postAsEmail: 'helper@example.com' })
      expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ botUsername: 'helper@example.com', botUserId: null }))
    })

    it('keeps the learned member id when the "post replies as" member is unchanged', async () => {
      h.getIntegration.mockResolvedValue(existing({ bot_username: 'support@example.com', bot_user_id: '31' }))
      await save({ ...base, postAsEmail: 'Support@Example.com' })
      expect(h.upsertIntegration.mock.calls[0][0].botUserId).toBeUndefined()
    })

    it('saves team member ids as a list, dropping blanks', async () => {
      await save({ ...base, teamMemberIds: ' 101, ,202 ' })
      expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ teamMemberIds: ['101', '202'] }))
    })

    it('refuses team member ids that are not numeric', async () => {
      const result = await save({ ...base, teamMemberIds: '101, erin' })
      expect(result).toEqual({ error: 'Team member Circle IDs must be numeric member IDs, separated by commas.' })
      expect(h.upsertIntegration).not.toHaveBeenCalled()
    })

    it('turns Automatic Deflections on when the switch is on', async () => {
      await save({ ...base, autoDeflectEnabled: 'on' })
      expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ autoDeflectEnabled: true }))
    })

    it('turns Automatic Deflections off when the switch is off, since an unchecked switch sends nothing', async () => {
      h.getIntegration.mockResolvedValue(existing({ auto_deflect_enabled: 1 }))
      await save({ ...base })
      expect(h.upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ autoDeflectEnabled: false }))
    })

    it('a plain member cannot change any of these', async () => {
      h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
      await save({ ...base, postAsEmail: 'support@example.com', teamMemberIds: '101', autoDeflectEnabled: 'on' })
      expect(h.upsertIntegration).not.toHaveBeenCalled()
    })
  })
})
