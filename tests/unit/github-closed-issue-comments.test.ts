// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// A comment on a closed issue joins the issue's existing ticket (the pipeline
// reopens it if it was resolved) but never opens a ticket of its own, and a
// maintainer's comment is kept as thread context only when that ticket exists.

const SECRET = 'test-webhook-secret'
const h = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(),
  recordThreadContextMessage: vi.fn(),
  getTicketByThreadId: vi.fn(),
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
vi.mock('@/lib/github/app', () => ({ getInstallationOctokitById: vi.fn() }))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))

async function comment(association: string, state: string) {
  const body = JSON.stringify({
    action: 'created',
    repository: { name: 'r', owner: { login: 'o' } },
    issue: { number: 5, state },
    comment: { id: 11, body: 'a long enough comment body', author_association: association, user: { login: 'bob', id: 2, type: 'User' } },
  })
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')
  const { POST } = await import('@/app/api/github/webhook/route')
  return POST(new Request('http://localhost/api/github/webhook', {
    method: 'POST',
    headers: { 'x-github-event': 'issue_comment', 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body,
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
  h.getTicketByThreadId.mockResolvedValue({ id: 1 })
  h.processCommunityMessage.mockResolvedValue({ ticket_id: 1 })
})

describe('issue comments on a closed issue', () => {
  it('a customer comment is handed to the pipeline when the issue already has a ticket', async () => {
    const res = await comment('NONE', 'closed')
    expect(res.status).toBe(200)
    expect(h.getTicketByThreadId).toHaveBeenCalledWith('github-issue-o-r-5', 9)
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({
      threadId: 'github-issue-o-r-5',
      platform: 'github',
    })
  })

  it('a maintainer comment is kept as thread context when the issue has a ticket', async () => {
    await comment('OWNER', 'closed')
    expect(h.recordThreadContextMessage).toHaveBeenCalledTimes(1)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it.each(['NONE', 'OWNER'])('a %s comment is ignored when the issue has no ticket', async (assoc) => {
    h.getTicketByThreadId.mockResolvedValue(null)
    const res = await comment(assoc, 'closed')
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
  })

  it('control: a comment on an open issue is processed without a ticket lookup gate', async () => {
    h.getTicketByThreadId.mockResolvedValue(null)
    await comment('NONE', 'open')
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })
})
