// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// A comment on a closed issue is ignored outright: not a ticket, and not a
// maintainer "context" message either (the thread-context path must sit behind
// the open-issue check).

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
  it.each(['NONE', 'OWNER'])('are ignored for a %s author: no ticket, no thread context', async (assoc) => {
    const res = await comment(assoc, 'closed')
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
  })

  it('control: the same comment on an open issue is processed', async () => {
    await comment('NONE', 'open')
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })
})
