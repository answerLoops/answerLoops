// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// A GitHub issue is a conversation. Its comments must land on the issue's own
// ticket, not open tickets of their own, and a maintainer's comment must be
// kept in that thread as context without becoming a ticket or a notification.
// This drives the real webhook handler with a signed payload; only the
// pipeline and the lookups behind it are replaced.

const SECRET = 'test-webhook-secret'

const h = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(),
  recordThreadContextMessage: vi.fn(),
  getTicketByThreadId: vi.fn(),
  replyFn: vi.fn(),
}))

vi.mock('@/lib/ingest/pipeline', () => ({
  processCommunityMessage: h.processCommunityMessage,
  recordThreadContextMessage: h.recordThreadContextMessage,
}))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketByThreadId: h.getTicketByThreadId }))
vi.mock('@/lib/db/queries/github', () => ({
  getRepoByOwnerAndName: vi.fn(async () => ({
    id: 1, org_id: 9, installation_id: 5, kb_enabled: 0, monitored_events: 'both',
  })),
}))
vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({ enqueueKbSyncJob: vi.fn() }))
vi.mock('@/lib/github/kb-sync', () => ({ syncSingleDiscussionToKB: vi.fn() }))
vi.mock('@/lib/github/app', () => ({
  getInstallationOctokitById: vi.fn(async () => ({ rest: { issues: { createComment: h.replyFn } } })),
}))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ aiDraft: 'draft', aiDraftStatus: 'posted', severityScore: 0.2 }] }) }) }),
  }),
}))

function post(event: string, payload: unknown) {
  const body = JSON.stringify(payload)
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')
  return new Request('http://localhost/api/github/webhook', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body,
  })
}

const repository = { name: 'r', owner: { login: 'o' } }
const user = (login: string, type = 'User') => ({ login, id: 1, type })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
  h.processCommunityMessage.mockResolvedValue({ ticket_id: 42 })
  h.getTicketByThreadId.mockResolvedValue(null)
})

async function run(event: string, payload: unknown) {
  const { POST } = await import('@/app/api/github/webhook/route')
  return POST(post(event, payload) as never)
}

describe('GitHub issue comments continue the issue ticket', () => {
  it('passes the issue as the thread id, equal to the id the issue ticket was created under', async () => {
    await run('issues', {
      action: 'opened', repository, issue: { number: 5, title: 'Broken thing', body: 'it does not work at all', user: user('alice') },
    })
    const issueCall = h.processCommunityMessage.mock.calls[0][0]
    expect(issueCall.messageId).toBe('github-issue-o-r-5')
    expect(issueCall.threadId).toBeUndefined()

    h.processCommunityMessage.mockClear()
    await run('issue_comment', {
      action: 'created', repository, issue: { number: 5, state: 'open' },
      comment: { id: 77, body: 'I see the same thing here', user: user('bob') },
    })
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    const commentCall = h.processCommunityMessage.mock.calls[0][0]
    expect(commentCall).toMatchObject({
      messageId: 'github-issue-comment-o-r-77',
      threadId: issueCall.messageId,
      authorName: 'bob',
      platform: 'github',
    })
  })

  it('a comment on a different issue carries that issue as its thread', async () => {
    await run('issue_comment', {
      action: 'created', repository, issue: { number: 6, state: 'open' },
      comment: { id: 78, body: 'a comment on another issue', user: user('bob') },
    })
    expect(h.processCommunityMessage.mock.calls[0][0].threadId).toBe('github-issue-o-r-6')
  })

  it('does not post the AI draft back into an issue when the comment only joined a thread', async () => {
    h.processCommunityMessage.mockResolvedValue({ ticket_id: 42, appended: true })
    await run('issue_comment', {
      action: 'created', repository, issue: { number: 5, state: 'open' },
      comment: { id: 77, body: 'I see the same thing here', user: user('bob') },
    })
    expect(h.replyFn).not.toHaveBeenCalled()
  })

  it('keeps a short follow-up when the issue is already tracked, and drops it when it would open a ticket', async () => {
    const comment = (id: number) => ({
      action: 'created', repository, issue: { number: 5, state: 'open' },
      comment: { id, body: 'thanks!', user: user('bob') },
    })
    h.getTicketByThreadId.mockResolvedValue({ id: 42 })
    await run('issue_comment', comment(1))
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)

    h.processCommunityMessage.mockClear()
    h.getTicketByThreadId.mockResolvedValue(null)
    await run('issue_comment', comment(2))
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })
})

describe('GitHub discussion comments continue the discussion ticket', () => {
  it('passes the discussion as the thread id', async () => {
    await run('discussion_comment', {
      action: 'created', repository, discussion: { number: 12 },
      comment: { id: 90, body: 'a reply inside the discussion', user: user('carol') },
    })
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({
      messageId: 'github-discussion-comment-o-r-90',
      threadId: 'github-discussion-o-r-12',
    })
  })

  it('the discussion root is created under the same id its comments use as their thread', async () => {
    await run('discussion', {
      action: 'created', repository,
      discussion: { number: 12, title: 'How do I', body: 'set this up please', user: user('carol') },
    })
    expect(h.processCommunityMessage.mock.calls[0][0].messageId).toBe('github-discussion-o-r-12')
  })
})

describe('maintainer and bot comments', () => {
  it('stores a maintainer comment as thread context and creates no ticket', async () => {
    const res = await run('issue_comment', {
      action: 'created', repository, issue: { number: 5, state: 'open' },
      comment: { id: 80, body: 'Looking into this now', author_association: 'MEMBER', user: user('maint') },
    })
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).toHaveBeenCalledWith(
      { messageId: 'github-issue-comment-o-r-80', content: 'Looking into this now', authorName: 'maint', threadId: 'github-issue-o-r-5' },
      9
    )
  })

  it('stores a maintainer discussion comment as thread context too', async () => {
    await run('discussion_comment', {
      action: 'created', repository, discussion: { number: 12 },
      comment: { id: 91, body: 'Thanks, answering below', author_association: 'OWNER', user: user('maint') },
    })
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'github-discussion-comment-o-r-91', threadId: 'github-discussion-o-r-12' }),
      9
    )
  })

  it('ignores bot comments entirely', async () => {
    await run('issue_comment', {
      action: 'created', repository, issue: { number: 5, state: 'open' },
      comment: { id: 81, body: 'automated note from a bot', user: user('some-bot', 'Bot') },
    })
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
  })
})
