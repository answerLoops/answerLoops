// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// Closed-issue comments: the ticket lookup uses the org of the matched repo
// row, and a short comment still reaches the pipeline when the issue's ticket exists.

const SECRET = '<test-webhook-secret>'
const ORG = 42
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
    id: 1, org_id: 42, installation_id: 5, kb_enabled: 0, monitored_events: 'both',
  })),
}))
vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({ enqueueKbSyncJob: vi.fn() }))
vi.mock('@/lib/github/kb-sync', () => ({ syncSingleDiscussionToKB: vi.fn() }))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokitById: vi.fn() }))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))

async function comment(body: string, state: string) {
  const payload = JSON.stringify({
    action: 'created',
    repository: { name: 'r', owner: { login: 'o' } },
    issue: { number: 5, state },
    comment: { id: 11, body, author_association: 'NONE', user: { login: 'bob', id: 2, type: 'User' } },
  })
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(payload).digest('hex')
  const { POST } = await import('@/app/api/github/webhook/route')
  return POST(new Request('http://localhost/api/github/webhook', {
    method: 'POST',
    headers: { 'x-github-event': 'issue_comment', 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body: payload,
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
  h.getTicketByThreadId.mockResolvedValue({ id: 1 })
  h.processCommunityMessage.mockResolvedValue({ ticket_id: 1 })
})

describe('closed-issue comment handling scoped to the repo row org', () => {
  it('looks up the issue ticket with the org id of the repo row and processes under that org', async () => {
    await comment('a long enough comment body', 'closed')
    for (const call of h.getTicketByThreadId.mock.calls) {
      expect(call).toEqual(['github-issue-o-r-5', ORG])
    }
    expect(h.getTicketByThreadId).toHaveBeenCalled()
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    expect(h.processCommunityMessage.mock.calls[0][1]).toBe(ORG)
  })

  it('a short comment on a closed issue with an existing ticket still reaches the pipeline', async () => {
    const res = await comment('thanks!', 'closed')
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({
      content: 'thanks!', threadId: 'github-issue-o-r-5', platform: 'github',
    })
  })

  it('a short comment on a closed issue with no ticket is dropped', async () => {
    h.getTicketByThreadId.mockResolvedValue(null)
    await comment('thanks!', 'closed')
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })
})
