import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  dbRows: [] as unknown[][],
  deleteSpy: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  isMember: vi.fn(),
  updateSLAConfig: vi.fn(),
  saveFeedback: vi.fn(),
  getTicketById: vi.fn(),
  saveOrgROIConfig: vi.fn(),
  updateOrgName: vi.fn(),
  setOrgOnboarded: vi.fn(),
  getNotionConnectionRow: vi.fn(),
  deleteNotionConnection: vi.fn(),
  ingestUrl: vi.fn(),
  listIntegrations: vi.fn(),
  getPendingInvitations: vi.fn(),
  getDiscordGuildByGuildId: vi.fn(),
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth, unstable_update: vi.fn() }))
vi.mock('next/cache', () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('resend', () => ({ Resend: class {} }))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req-test' }))

// Chainable stand-in for the drizzle query builder: every chain resolves to
// the next queued row set.
vi.mock('@/lib/db/drizzle', () => {
  const chain = (): unknown => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'from', 'where', 'limit', 'orderBy']) c[k] = () => c
    c.then = (resolve: (v: unknown) => unknown) => resolve(h.dbRows.shift() ?? [])
    return c
  }
  return {
    getDb: () => ({
      select: () => chain(),
      delete: () => ({ where: h.deleteSpy }),
      transaction: vi.fn(),
    }),
  }
})
vi.mock('@/lib/db/queries/invitations', () => ({
  createInvitation: h.createInvitation,
  revokeInvitation: h.revokeInvitation,
  getInvitationByToken: vi.fn(),
  acceptInvitation: vi.fn(),
  getPendingInvitations: h.getPendingInvitations,
}))
vi.mock('@/lib/db/queries/members', () => ({ addMember: vi.fn(), isMember: h.isMember }))
vi.mock('@/lib/db/queries/sla', () => ({ updateSLAConfig: h.updateSLAConfig }))
vi.mock('@/lib/db/queries/feedback', () => ({ saveFeedback: h.saveFeedback }))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketById: h.getTicketById }))
vi.mock('@/lib/db/queries/orgs', () => ({
  saveOrgROIConfig: h.saveOrgROIConfig,
  updateOrgName: h.updateOrgName,
  setOrgOnboarded: h.setOrgOnboarded,
}))
vi.mock('@/lib/db/queries/notion', () => ({
  getNotionConnectionRow: h.getNotionConnectionRow,
  saveNotionConnection: vi.fn(),
  deleteNotionConnection: h.deleteNotionConnection,
  getNotionConnection: vi.fn(),
}))
vi.mock('@/lib/db/queries/kb-sources', () => ({ getKBSourceByFilename: vi.fn(), deleteKBSource: vi.fn() }))
vi.mock('@/lib/notion/kb-sync', () => ({ NOTION_SOURCE_FILENAME: 'notion' }))
vi.mock('@/lib/notion/client', () => ({ NOTION_TOKEN_RE: /^ntn_/, getNotionBotUser: vi.fn() }))
vi.mock('@/lib/crypto/tokens', () => ({ encryptToken: (t: string) => t }))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: true }))
vi.mock('@/lib/ingest/url', () => ({
  ingestUrl: h.ingestUrl,
  ingestSite: vi.fn(),
  IngestLimitError: class extends Error {},
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => ({ ok: true }) }))
vi.mock('@/lib/db/queries/integrations', () => ({
  listIntegrations: h.listIntegrations,
  parseChannelIds: () => [],
}))
vi.mock('@/lib/db/queries/discord-guilds', () => ({ getDiscordGuildByGuildId: h.getDiscordGuildByGuildId }))
vi.mock('@/lib/db/queries/billing', () => ({ getSubscription: h.getSubscription }))
vi.mock('@/lib/billing/stripe', () => ({ getStripe: () => ({}) }))
vi.mock('@/lib/billing/plans', () => ({ stripeConfigured: () => true, parseBillingInterval: () => 'monthly' }))
vi.mock('@/lib/billing/checkout', () => ({
  createCheckoutSession: h.createCheckoutSession,
  createEmbeddedCheckoutSession: vi.fn(),
}))

const ok = (role: 'owner' | 'admin' | 'member', orgId = 7, userId = 3) => ({ ok: true as const, orgId, userId, role })
const denied = { ok: false as const, error: 'You do not have permission to do that.' }

const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbRows.length = 0
  process.env.FIRECRAWL_API_KEY = 'test'
})

describe('invitations', () => {
  it('requires owner/admin and surfaces the denial', async () => {
    const { sendInviteAction, revokeInviteAction, removeMemberAction } = await import('@/lib/actions/invitations')
    h.requireOrgAccess.mockResolvedValue(denied)
    for (const r of [
      await sendInviteAction(null, form({ email: 'a@b.co', role: 'member' })),
      await revokeInviteAction(null, form({ id: '1' })),
      await removeMemberAction(null, form({ membershipId: '1' })),
    ]) expect(r).toEqual({ error: denied.error })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.createInvitation).not.toHaveBeenCalled()
    expect(h.revokeInvitation).not.toHaveBeenCalled()
    expect(h.deleteSpy).not.toHaveBeenCalled()
  })

  it('lets only an owner invite an admin', async () => {
    const { sendInviteAction } = await import('@/lib/actions/invitations')
    h.requireOrgAccess.mockResolvedValue(ok('admin'))
    const r = await sendInviteAction(null, form({ email: 'a@b.co', role: 'admin' }))
    expect(r).toEqual({ error: 'Only an owner can invite an admin.' })
    expect(h.createInvitation).not.toHaveBeenCalled()

    h.requireOrgAccess.mockResolvedValue(ok('owner'))
    h.dbRows.push([]) // no existing user
    const r2 = await sendInviteAction(null, form({ email: 'a@b.co', role: 'admin' }))
    expect(r2?.inviteUrl).toBeTruthy()
    expect(h.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ orgId: 7, role: 'admin', invitedBy: 3 }))
  })

  it('lets an admin invite a member, scoped to the verified org', async () => {
    const { sendInviteAction } = await import('@/lib/actions/invitations')
    h.requireOrgAccess.mockResolvedValue(ok('admin', 9, 4))
    h.dbRows.push([])
    const r = await sendInviteAction(null, form({ email: 'a@b.co', role: 'member' }))
    expect(r?.inviteUrl).toBeTruthy()
    expect(h.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ orgId: 9, invitedBy: 4 }))
  })

  it('never removes an owner, and only an owner removes an admin', async () => {
    const { removeMemberAction } = await import('@/lib/actions/invitations')
    h.requireOrgAccess.mockResolvedValue(ok('owner'))
    h.dbRows.push([{ role: 'owner', userId: 99 }])
    expect(await removeMemberAction(null, form({ membershipId: '5' }))).toEqual({ error: 'Owners cannot be removed.' })

    h.requireOrgAccess.mockResolvedValue(ok('admin'))
    h.dbRows.push([{ role: 'admin', userId: 99 }])
    expect(await removeMemberAction(null, form({ membershipId: '5' }))).toEqual({ error: 'Only an owner can remove an admin.' })
    expect(h.deleteSpy).not.toHaveBeenCalled()

    h.dbRows.push([{ role: 'member', userId: 99 }])
    expect(await removeMemberAction(null, form({ membershipId: '5' }))).toBeNull()
    expect(h.deleteSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses self-removal based on the membership row, not the submitted userId', async () => {
    const { removeMemberAction } = await import('@/lib/actions/invitations')
    h.requireOrgAccess.mockResolvedValue(ok('owner', 7, 3))
    h.dbRows.push([{ role: 'admin', userId: 3 }])
    expect(await removeMemberAction(null, form({ membershipId: '5', userId: '999' }))).toEqual({ error: "You can't remove yourself." })
  })
})

describe('owner/admin-only actions', () => {
  it('sla: gated, and saved to the caller\'s own org', async () => {
    const { updateSLAAction } = await import('@/lib/actions/sla')
    const fd = form({ priority: 'high', responseHours: '1', resolveHours: '4' })
    h.requireOrgAccess.mockResolvedValue(denied)
    expect(await updateSLAAction(null, fd)).toEqual({ error: denied.error })
    expect(h.updateSLAConfig).not.toHaveBeenCalled()
    h.requireOrgAccess.mockResolvedValue(ok('admin', 42))
    expect(await updateSLAAction(null, fd)).toBeNull()
    expect(h.updateSLAConfig).toHaveBeenCalledWith(42, 'high', 1, 4)
    h.requireOrgAccess.mockResolvedValue(ok('owner', 7))
    expect(await updateSLAAction(null, fd)).toBeNull()
    expect(h.updateSLAConfig).toHaveBeenLastCalledWith(7, 'high', 1, 4)
  })

  it('roi, notion, onboarding and url import are gated', async () => {
    h.requireOrgAccess.mockResolvedValue(denied)
    const { saveROIConfigAction } = await import('@/lib/actions/roi')
    const { deleteNotionConnectionAction, saveNotionConnectionAction } = await import('@/lib/actions/notion')
    const { updateWorkspaceNameAction, completeOnboardingAction } = await import('@/lib/actions/onboarding')
    const { ingestUrlAction } = await import('@/lib/actions/ingest-url')

    expect(await saveROIConfigAction(null, form({ minutesPerTicket: '5', staffHourlyRate: '20' }))).toEqual({ error: denied.error })
    expect(await deleteNotionConnectionAction(null, new FormData())).toEqual({ error: denied.error })
    expect(await saveNotionConnectionAction(null, form({ token: 'ntn_x' }))).toEqual({ error: denied.error })
    expect(await updateWorkspaceNameAction(null, form({ name: 'x' }))).toEqual({ error: denied.error })
    expect(await completeOnboardingAction()).toEqual({ error: denied.error })
    expect(await ingestUrlAction(null, form({ url: 'https://example.com', mode: 'page' }))).toEqual({ error: denied.error })

    expect(h.requireOrgAccess).toHaveBeenCalledTimes(6)
    for (const call of h.requireOrgAccess.mock.calls) expect(call[0]).toEqual(['owner', 'admin'])
    expect(h.saveOrgROIConfig).not.toHaveBeenCalled()
    expect(h.deleteNotionConnection).not.toHaveBeenCalled()
    expect(h.updateOrgName).not.toHaveBeenCalled()
    expect(h.setOrgOnboarded).not.toHaveBeenCalled()
    expect(h.ingestUrl).not.toHaveBeenCalled()
  })

  it('uses the verified org id for authorised callers', async () => {
    h.requireOrgAccess.mockResolvedValue(ok('owner', 12))
    const { updateWorkspaceNameAction } = await import('@/lib/actions/onboarding')
    expect(await updateWorkspaceNameAction(null, form({ name: 'Acme' }))).toBeNull()
    expect(h.updateOrgName).toHaveBeenCalledWith(12, 'Acme')
  })
})

describe('feedback', () => {
  it('rejects unauthenticated callers and tickets from other orgs', async () => {
    const { submitFeedbackAction } = await import('@/lib/actions/feedback')
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await submitFeedbackAction(null, form({ ticketId: '1', vote: 'up' }))).toEqual({ error: 'Unauthorized' })

    h.requireOrgAccess.mockResolvedValue(ok('member', 7))
    h.getTicketById.mockResolvedValue(null)
    expect(await submitFeedbackAction(null, form({ ticketId: '1', vote: 'up' }))).toEqual({ error: 'Ticket not found' })
    expect(h.getTicketById).toHaveBeenCalledWith(1, 7)
    expect(h.saveFeedback).not.toHaveBeenCalled()
  })

  it('awaits the write and hides internal errors', async () => {
    const { submitFeedbackAction } = await import('@/lib/actions/feedback')
    h.requireOrgAccess.mockResolvedValue(ok('member', 7))
    h.getTicketById.mockResolvedValue({ id: 1 })
    h.saveFeedback.mockRejectedValue(new Error('relation "ticket_feedback" broke'))
    const r = await submitFeedbackAction(null, form({ ticketId: '1', vote: 'down' }))
    expect(r?.error).toBeTruthy()
    expect(r?.error).not.toMatch(/relation/)
  })
})

describe('GET /api/integrations', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 1, org_id: 7, platform: 'telegram', bot_token: 'tok-abcd1234', bot_secret: 'sec-value',
    webhook_secret: 'whsec-value', bot_username: null, channel_ids: null, guild_channel_map: '{}',
    connected_guild_id: null, team_id: null, webhook_registered_at: null, escalation_role_id: null,
    confidence_threshold: null, enabled: 1, auto_deflect_enabled: 0, email_send_method: 'platform',
    created_at: 'x', updated_at: 'y', ...over,
  })

  it('never serialises stored credentials', async () => {
    const { GET } = await import('@/app/api/integrations/route')
    h.requireOrgAccess.mockResolvedValue(ok('owner'))
    h.listIntegrations.mockResolvedValue([row(), row({ id: 2, platform: 'slack' })])
    const res = await GET(new Request('http://x/api/integrations'))
    const text = await res.text()
    expect(text).not.toContain('tok-abcd1234')
    expect(text).not.toContain('sec-value')
    expect(text).not.toContain('whsec-value')
    const [first] = JSON.parse(text)
    expect(first).toMatchObject({ bot_token_last4: '1234', has_bot_token: true, has_webhook_secret: true, bot_secret: null })
    expect(first).not.toHaveProperty('bot_token')
    expect(first).not.toHaveProperty('webhook_secret')
  })

  it('only gives owner/admins the pending Google Chat connect code', async () => {
    const { GET } = await import('@/app/api/integrations/route')
    const gc = row({ platform: 'google_chat', enabled: 0, bot_secret: 'gc_pending' })
    h.listIntegrations.mockResolvedValue([gc])
    h.requireOrgAccess.mockResolvedValue(ok('admin'))
    expect((await (await GET(new Request('http://x'))).json())[0].bot_secret).toBe('gc_pending')
    h.requireOrgAccess.mockResolvedValue(ok('member'))
    expect((await (await GET(new Request('http://x'))).json())[0].bot_secret).toBeNull()
  })
})

describe('team invites', () => {
  it('does not hand invite tokens to plain members', async () => {
    const { GET } = await import('@/app/api/team/invites/route')
    h.getPendingInvitations.mockResolvedValue([
      { id: 1, org_id: 7, email: 'a@b.co', role: 'member', token: 'secret-token', invited_by: 1, expires_at: 'x', accepted_at: null, created_at: 'y' },
    ])
    h.requireOrgAccess.mockResolvedValue(ok('member'))
    const memberBody = await (await GET(new Request('http://x') as never)).text()
    expect(memberBody).not.toContain('secret-token')
    h.requireOrgAccess.mockResolvedValue(ok('admin'))
    const adminBody = await (await GET(new Request('http://x') as never)).text()
    expect(adminBody).toContain('secret-token')
  })
})

describe('discord guild channels', () => {
  const req = (id: string) => ({ nextUrl: new URL(`http://x/api/discord/guilds?guild_id=${id}`) }) as never

  it('404s for a guild owned by another org before calling Discord', async () => {
    process.env.DISCORD_TOKEN = 'platform-token'
    const { GET } = await import('@/app/api/discord/guilds/route')
    h.requireOrgAccess.mockResolvedValue(ok('owner', 7))
    h.getDiscordGuildByGuildId.mockResolvedValue({ org_id: 8, guild_id: 'g1' })
    expect((await GET(req('g1'))).status).toBe(404)
    h.getDiscordGuildByGuildId.mockResolvedValue(null)
    expect((await GET(req('g1'))).status).toBe(404)
    h.getDiscordGuildByGuildId.mockResolvedValue({ org_id: 7, guild_id: 'g1' })
    expect((await GET(req('guild-1'))).status).toBe(200)
  })

  it('403s members', async () => {
    const { GET } = await import('@/app/api/discord/guilds/route')
    h.requireOrgAccess.mockResolvedValue(denied)
    expect((await GET(req('g1'))).status).toBe(403)
  })
})

describe('billing routes', () => {
  it('portal is owner-only', async () => {
    const { POST } = await import('@/app/api/billing/portal/route')
    h.requireOrgAccess.mockResolvedValue(denied)
    expect((await POST()).status).toBe(403)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner'])
    expect(h.getSubscription).not.toHaveBeenCalled()
  })

  it('checkout is owner/admin-only and validates the body', async () => {
    h.auth.mockResolvedValue({ user: { email: 'a@b.co', name: 'A' } })
    const { POST } = await import('@/app/api/billing/checkout/route')
    const post = (body: string) => POST(new Request('http://x', { method: 'POST', body }))

    h.requireOrgAccess.mockResolvedValue(denied)
    expect((await post('{"planId":"standard"}')).status).toBe(403)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])

    h.requireOrgAccess.mockResolvedValue(ok('admin'))
    expect((await post('not json')).status).toBe(400)
    expect((await post('{"planId":42}')).status).toBe(400)
    expect(h.createCheckoutSession).not.toHaveBeenCalled()

    h.createCheckoutSession.mockResolvedValue({ ok: true, url: 'https://pay.test' })
    expect((await post('{"planId":"standard"}')).status).toBe(200)
  })
})
