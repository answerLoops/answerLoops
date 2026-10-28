// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

// A short post that continues a conversation we already track ("thanks, that
// worked") belongs in it, while the same text would not be worth a ticket of
// its own. Discourse threads by topic and Circle by post, so both must keep
// the short follow-up when the topic or post has a ticket and drop it when not.

const h = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(),
  getTicketByThreadId: vi.fn(),
}))

vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketByThreadId: h.getTicketByThreadId }))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))
vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByDiscourseSite: vi.fn(async () => ({
    platform: 'discourse', bot_secret: 'discourse-secret', bot_username: 'helper', org_id: 6, team_id: 'https://forum.example', channel_ids: null,
  })),
  getIntegrationByBotSecret: vi.fn(async () => ({
    platform: 'circle', enabled: 1, org_id: 6, bot_token: null, team_id: null, channel_ids: null,
  })),
  parseChannelIds: vi.fn(() => []),
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.getTicketByThreadId.mockResolvedValue(null)
})

async function discourse(raw: string, topicId = 10) {
  const body = JSON.stringify({ post: { id: 5, user_id: 3, username: 'dana', raw, post_number: 2, post_type: 1, topic_id: topicId, category_id: 1 } })
  const sig = 'sha256=' + createHmac('sha256', 'discourse-secret').update(body, 'utf8').digest('hex')
  const { POST } = await import('@/app/api/discourse/webhook/route')
  return POST(new Request('http://localhost/api/discourse/webhook', {
    method: 'POST',
    headers: { 'x-discourse-instance': 'https://forum.example', 'x-discourse-event': 'post_created', 'x-discourse-event-signature': sig },
    body,
  }) as never)
}

async function circle(body: string, postId = 55) {
  const { POST } = await import('@/app/api/circle/webhook/route')
  return POST(new NextRequest('http://localhost/api/circle/webhook?kind=comment', {
    method: 'POST',
    headers: { 'x-answerloops-token': 'circle-secret' },
    body: JSON.stringify({ comment: { id: 9, body, user_id: 4, user_name: 'erin', space_id: 2, post_id: postId } }),
  }))
}

describe('Discourse', () => {
  it('keeps a short post in a topic that already has a ticket, keyed by that topic', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 1 })
    await discourse('thanks!', 10)
    expect(h.getTicketByThreadId).toHaveBeenCalledWith('10', 6)
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({ threadId: '10', platform: 'discourse' })
  })

  it('still drops a short post that would open a ticket', async () => {
    await discourse('thanks!')
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('keeps a long post either way', async () => {
    await discourse('How do I reset my password on mobile?')
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })
})

describe('Circle', () => {
  it('keeps a short comment on a post that already has a ticket, keyed by that post', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 1 })
    await circle('thanks!', 55)
    expect(h.getTicketByThreadId).toHaveBeenCalledWith('55', 6)
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({ threadId: '55', platform: 'circle' })
  })

  it('still drops a short comment that would open a ticket', async () => {
    await circle('thanks!')
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('keeps a long comment either way', async () => {
    await circle('Does this also work for team plans?')
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })
})
