// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// When a Circle Workflow sends only ids, the webhook fills in the post or
// comment from Circle's Admin API. If that lookup can't be done, the delivery
// is answered with 502 and logged, so it shows as Failed in the owner's
// Circle Workflow history instead of vanishing or crashing.

const h = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(),
  getTicketByThreadId: vi.fn(),
  fetchCircleRecord: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketByThreadId: h.getTicketByThreadId }))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))
vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByBotSecret: vi.fn(async () => ({
    platform: 'circle', enabled: 1, org_id: 6, bot_token: 'encrypted', team_id: 'https://community.example', channel_ids: null,
  })),
  parseChannelIds: vi.fn(() => []),
}))
vi.mock('@/lib/crypto/tokens', () => ({ decryptToken: () => 'circle-api-token' }))
vi.mock('@/lib/circle/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/circle/client')>()),
  fetchCircleRecord: h.fetchCircleRecord,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  h.getTicketByThreadId.mockResolvedValue(null)
})

async function thinPost(id = 42) {
  const { POST } = await import('@/app/api/circle/webhook/route')
  return POST(new NextRequest('http://localhost/api/circle/webhook?kind=post', {
    method: 'POST',
    headers: { 'x-answerloops-token': 'circle-secret' },
    body: JSON.stringify({ post: { id, user_id: 4, space_id: 2 } }),
  }))
}

describe('Circle webhook — filling in a thin payload', () => {
  it('ingests the post fetched from the Admin API', async () => {
    h.fetchCircleRecord.mockResolvedValue({ ok: true, record: { id: 42, name: 'Billing', body: 'How do I change my card?', user_id: 4, user_name: 'erin', space_id: 2 } })
    const res = await thinPost()
    expect(res.status).toBe(200)
    expect(h.fetchCircleRecord).toHaveBeenCalledWith('circle-api-token', 'post', '42')
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({ messageId: 'circle-post-42', content: 'Billing\n\nHow do I change my card?' })
  })

  it('answers 502 and logs why when Circle can\'t be reached, without creating a ticket', async () => {
    h.fetchCircleRecord.mockResolvedValue({ ok: false, reason: 'unreachable' })
    const res = await thinPost()
    expect(res.status).toBe(502)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    const [message, meta] = h.warn.mock.calls.find(([m]) => /Circle API/.test(m))!
    expect(message).toMatch(/could not fetch/)
    expect(meta).toMatchObject({ orgId: 6, kind: 'post', id: '42', reason: 'unreachable' })
    expect(JSON.stringify(h.warn.mock.calls)).not.toContain('circle-api-token')
  })

  it('answers 502 with the status when Circle refuses the lookup', async () => {
    h.fetchCircleRecord.mockResolvedValue({ ok: false, reason: 'status', status: 401 })
    const res = await thinPost()
    expect(res.status).toBe(502)
    expect(h.warn.mock.calls.find(([m]) => /Circle API/.test(m))![1]).toMatchObject({ reason: 'status', status: 401 })
  })

  it('acknowledges a thin payload quietly when lookups are off', async () => {
    h.fetchCircleRecord.mockResolvedValue({ ok: false, reason: 'off' })
    const res = await thinPost()
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('does not call the API when the payload already has the text', async () => {
    const { POST } = await import('@/app/api/circle/webhook/route')
    await POST(new NextRequest('http://localhost/api/circle/webhook?kind=post', {
      method: 'POST',
      headers: { 'x-answerloops-token': 'circle-secret' },
      body: JSON.stringify({ post: { id: 43, body: 'How do I export my data?', user_id: 4, space_id: 2 } }),
    }))
    expect(h.fetchCircleRecord).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })
})
