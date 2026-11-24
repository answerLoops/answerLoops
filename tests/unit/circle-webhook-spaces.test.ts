// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// With Watched space IDs set, only posts in those spaces open tickets. A
// comment on a post that already has a ticket belongs to that conversation,
// so it is kept even when its payload doesn't say which space it is in.

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
  getIntegrationByBotSecret: vi.fn(async () => ({
    platform: 'circle', enabled: 1, org_id: 6, bot_token: null, team_id: null, channel_ids: '2',
  })),
  parseChannelIds: vi.fn(() => ['2']),
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.getTicketByThreadId.mockResolvedValue(null)
})

async function send(kind: 'post' | 'comment', record: Record<string, unknown>) {
  const { POST } = await import('@/app/api/circle/webhook/route')
  return POST(new NextRequest(`http://localhost/api/circle/webhook?kind=${kind}`, {
    method: 'POST',
    headers: { 'x-answerloops-token': 'circle-secret' },
    body: JSON.stringify({ [kind]: record }),
  }))
}

const text = 'Does this also work for team plans?'

describe('Circle webhook — watched spaces', () => {
  it('opens a ticket for a post in a watched space', async () => {
    await send('post', { id: 40, body: text, user_id: 4, space_id: 2 })
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })

  it('ignores a post in another space', async () => {
    const res = await send('post', { id: 41, body: text, user_id: 4, space_id: 9 })
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('keeps a comment on a tracked post even when its payload has no space', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 1 })
    await send('comment', { id: 9, body: text, user_id: 4, post_id: 40 })
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({ threadId: '40', messageId: 'circle-comment-9' })
  })

  it('keeps a short comment on a tracked post with no space', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 1 })
    await send('comment', { id: 10, body: 'thanks!', user_id: 4, post_id: 40 })
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })

  it('still ignores a comment on an untracked post outside the watched spaces', async () => {
    await send('comment', { id: 11, body: text, user_id: 4, post_id: 77, space_id: 9 })
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('still ignores a comment on an untracked post whose space is unknown', async () => {
    await send('comment', { id: 12, body: text, user_id: 4, post_id: 78 })
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })
})
