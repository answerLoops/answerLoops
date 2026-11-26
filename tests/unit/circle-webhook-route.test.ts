// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/ingest/limits'

// Behaviour of the Circle ingest webhook, exercised through the real POST
// handler: which requests it accepts, how it reads the Workflow payload, what
// it acknowledges without ingesting, and exactly what it hands to the shared
// ingest pipeline. Lookups for thin payloads are covered in
// circle-webhook-lookup.test.ts.

const h = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(),
  recordThreadContextMessage: vi.fn(),
  getTicketByThreadId: vi.fn(),
  isPostedByAnswerLoops: vi.fn(),
  getIntegrationByBotSecret: vi.fn(),
  parseChannelIds: vi.fn(),
  parseTeamMemberIds: vi.fn(),
  isIngestRateLimited: vi.fn(),
  fetchCircleRecord: vi.fn(),
  decryptToken: vi.fn((value: string) => `decrypted(${value})`),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/ingest/pipeline', () => ({
  processCommunityMessage: h.processCommunityMessage,
  recordThreadContextMessage: h.recordThreadContextMessage,
}))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketByThreadId: h.getTicketByThreadId,
  isPostedByAnswerLoops: h.isPostedByAnswerLoops,
}))
vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByBotSecret: h.getIntegrationByBotSecret,
  parseChannelIds: h.parseChannelIds,
  parseTeamMemberIds: h.parseTeamMemberIds,
}))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: h.isIngestRateLimited,
}))
vi.mock('@/lib/circle/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/circle/client')>()),
  fetchCircleRecord: h.fetchCircleRecord,
}))
vi.mock('@/lib/crypto/tokens', () => ({ decryptToken: h.decryptToken }))
vi.mock('@/lib/logger', () => ({ logger: { info: h.info, warn: h.warn, error: vi.fn(), debug: vi.fn() } }))

const TOKEN = 'circle-webhook-token'
const COMMUNITY = 'https://community.example'
const LONG = 'How do I change the card on my account?'

// getIntegrationByBotSecret returns hydrated rows, so bot_token here is the
// already-decrypted Admin API token.
const integration = (over: Record<string, unknown> = {}) => ({
  platform: 'circle', enabled: 1, org_id: 6, bot_token: 'circle-api-token', team_id: COMMUNITY, channel_ids: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.getIntegrationByBotSecret.mockResolvedValue(integration())
  h.parseChannelIds.mockReturnValue([])
  h.parseTeamMemberIds.mockReturnValue([])
  h.isPostedByAnswerLoops.mockResolvedValue(false)
  h.recordThreadContextMessage.mockResolvedValue(true)
  h.isIngestRateLimited.mockResolvedValue(false)
  h.getTicketByThreadId.mockResolvedValue(null)
  h.fetchCircleRecord.mockResolvedValue({ ok: false, reason: 'off' })
})

interface SendOptions {
  query?: string
  headers?: Record<string, string>
  token?: string | null
}

async function send(body: unknown, { query = '', headers, token = TOKEN }: SendOptions = {}) {
  const { POST } = await import('@/app/api/circle/webhook/route')
  return POST(new NextRequest(`http://localhost/api/circle/webhook${query}`, {
    method: 'POST',
    headers: headers ?? (token ? { 'x-answerloops-token': token } : {}),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

const post = (over: Record<string, unknown> = {}) => ({ post: { id: 42, name: 'Billing', body: LONG, user_id: 4, user_name: 'erin', space_id: 2, ...over } })
const comment = (over: Record<string, unknown> = {}) => ({ comment: { id: 9, body: LONG, user_id: 4, user_name: 'erin', space_id: 2, post_id: 42, ...over } })

const handedOff = () => h.processCommunityMessage.mock.calls[0][0]
const droppedLog = () => h.info.mock.calls.find(([message]) => /acknowledged without ingesting/.test(message))

describe('Circle webhook: who may deliver', () => {
  it('rejects a request with no token with 401 and never looks up an integration', async () => {
    const res = await send(post(), { token: null })
    expect(res.status).toBe(401)
    expect(h.getIntegrationByBotSecret).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('rejects a token that matches no integration with 401', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(null)
    const res = await send(post(), { token: 'not-the-token' })
    expect(res.status).toBe(401)
    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith('not-the-token', 'circle')
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('rejects a disabled integration with 401', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ enabled: 0 }))
    const res = await send(post())
    expect(res.status).toBe(401)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('rejects an integration for another platform with 401', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ platform: 'discourse' }))
    const res = await send(post())
    expect(res.status).toBe(401)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('accepts the token from the x-answerloops-token header without logging the query-param path', async () => {
    const res = await send(post())
    expect(res.status).toBe(200)
    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith(TOKEN, 'circle')
    expect(h.info.mock.calls.some(([message]) => /\?token=/.test(message))).toBe(false)
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })

  it('accepts the token from ?token= and logs that path with the org but never the value', async () => {
    const res = await send(post(), { query: `?token=${TOKEN}`, token: null })
    expect(res.status).toBe(200)
    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith(TOKEN, 'circle')
    const [, meta] = h.info.mock.calls.find(([message]) => /\?token=/.test(message))!
    expect(meta).toMatchObject({ orgId: 6 })
    expect(JSON.stringify([h.info.mock.calls, h.warn.mock.calls])).not.toContain(TOKEN)
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })

  it('prefers the header over ?token= when both are present', async () => {
    await send(post(), { query: '?token=query-value', headers: { 'x-answerloops-token': TOKEN } })
    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith(TOKEN, 'circle')
  })
})

describe('Circle webhook: request limits', () => {
  it('answers 429 when the org is over its ingest rate, before reading the body', async () => {
    h.isIngestRateLimited.mockResolvedValue(true)
    const res = await send(post())
    expect(res.status).toBe(429)
    expect(h.isIngestRateLimited).toHaveBeenCalledWith(6)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('answers 413 for a body over the size cap', async () => {
    const res = await send(JSON.stringify(post({ body: 'x'.repeat(WEBHOOK_MAX_BODY_BYTES + 1) })))
    expect(res.status).toBe(413)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that is not JSON', async () => {
    const res = await send('{"post": ')
    expect(res.status).toBe(400)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })
})

describe('Circle webhook: reading the payload', () => {
  it('treats body.comment as a comment threaded under its post', async () => {
    await send(comment())
    expect(handedOff()).toMatchObject({ messageId: 'circle-comment-9', threadId: '42' })
  })

  it('treats body.post as a post threaded under itself', async () => {
    await send(post())
    expect(handedOff()).toMatchObject({ messageId: 'circle-post-42', threadId: '42', content: `Billing\n\n${LONG}` })
  })

  it('lets ?kind=comment decide a generic record with no comment-only keys', async () => {
    await send({ event: 'post_created', record: { id: 9, body: LONG, user_id: 4, space_id: 2 } }, { query: '?kind=comment' })
    expect(handedOff()).toMatchObject({ messageId: 'circle-comment-9' })
  })

  it('lets ?kind=post decide a generic record that looks like a comment', async () => {
    await send({ event: 'comment_created', data: { id: 50, body: LONG, user_id: 4, space_id: 2, post_id: 42 } }, { query: '?kind=post' })
    expect(handedOff()).toMatchObject({ messageId: 'circle-post-50', threadId: '50' })
  })

  it('falls back to the event name when ?kind= is absent or unrecognised', async () => {
    await send({ event: 'comment_created', record: { id: 9, body: LONG, user_id: 4, space_id: 2, post_id: 42 } }, { query: '?kind=other' })
    expect(handedOff()).toMatchObject({ messageId: 'circle-comment-9', threadId: '42' })
  })

  it('falls back to comment-only keys when neither ?kind= nor the event name says', async () => {
    await send({ data: { id: 9, body: LONG, user_id: 4, space_id: 2, parent_id: 1, post_id: 42 } })
    expect(handedOff()).toMatchObject({ messageId: 'circle-comment-9' })
  })

  it('reads a generic record without any hint as a post', async () => {
    await send({ record: { id: 60, body: LONG, user_id: 4, space_id: 2 } })
    expect(handedOff()).toMatchObject({ messageId: 'circle-post-60' })
  })
})

describe('Circle webhook: deliveries acknowledged without ingesting', () => {
  it('acknowledges a payload with no recognisable record and logs it', async () => {
    const res = await send({ event: 'member_joined', member: { id: 1 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ orgId: 6, reason: 'no record' })
  })

  it('acknowledges a record with no id and logs it', async () => {
    const { id: _omit, ...withoutId } = post().post
    const res = await send({ post: withoutId })
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ orgId: 6, kind: 'post', reason: 'no id' })
  })

  it('acknowledges a record with an empty id and logs it', async () => {
    const res = await send(post({ id: '' }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ orgId: 6, kind: 'post', reason: 'no id' })
  })

  it('drops a new post shorter than 10 characters and logs it', async () => {
    const res = await send(post({ name: undefined, body: 'help pls' }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ orgId: 6, kind: 'post', id: '42', reason: 'too short' })
  })

  it('ingests a new post of exactly 10 characters', async () => {
    await send(post({ name: undefined, body: 'help me 10' }))
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })

  it('drops a record whose text is empty and logs it', async () => {
    const res = await send(post({ name: undefined, body: '' }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ reason: 'too short' })
  })

  it.each([
    ['no author', { user_id: undefined }],
    ['author 0', { user_id: 0 }],
    ["author '0'", { user_id: '0' }],
  ])('drops a record with %s and logs it', async (_label, over) => {
    const res = await send(post(over))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ orgId: 6, kind: 'post', id: '42', reason: 'no author' })
  })

  it('drops a post outside the watched spaces and logs it', async () => {
    h.parseChannelIds.mockReturnValue(['7'])
    const res = await send(post({ space_id: 2 }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ orgId: 6, kind: 'post', id: '42', reason: 'outside watched spaces' })
  })

  it('ingests a post inside the watched spaces without a drop log', async () => {
    h.parseChannelIds.mockReturnValue(['7', '2'])
    await send(post({ space_id: 2 }))
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
    expect(droppedLog()).toBeUndefined()
  })

  it('never logs the record text or the token when dropping a delivery', async () => {
    h.parseChannelIds.mockReturnValue(['7'])
    await send(post({ body: 'A very particular sentence about invoices' }))
    await send(post({ user_id: undefined, body: 'Another very particular sentence' }))
    const logged = JSON.stringify([h.info.mock.calls, h.warn.mock.calls])
    expect(logged).not.toContain('particular sentence')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('circle-api-token')
  })
})

describe('Circle webhook: hand-off to the ingest pipeline', () => {
  it('passes the message id, thread, space, author and platform for a comment', async () => {
    await send(comment())
    expect(h.processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'circle-comment-9',
        content: LONG,
        authorId: '4',
        authorName: 'erin',
        channelId: '2',
        threadId: '42',
        platform: 'circle',
      }),
      6,
    )
  })

  it('uses the post id as the channel when the record has no space', async () => {
    await send(post({ space_id: undefined }))
    expect(handedOff()).toMatchObject({ channelId: '42', threadId: '42' })
  })

  it('names an author with no name a Circle member', async () => {
    await send(post({ user_name: undefined }))
    expect(handedOff()).toMatchObject({ authorName: 'Circle member' })
  })

  it('acknowledges with 200 after handing off', async () => {
    const res = await send(post())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('Circle webhook: the source link on the ticket', () => {
  it('uses a payload url on the connected community', async () => {
    await send(post({ url: `${COMMUNITY}/c/general/billing-question` }))
    expect(handedOff().sourceUrl).toBe(`${COMMUNITY}/c/general/billing-question`)
  })

  it('builds <community>/posts/<postId> when the payload has no url', async () => {
    await send(comment())
    expect(handedOff().sourceUrl).toBe(`${COMMUNITY}/posts/42`)
  })

  it('drops trailing slashes from the community url when building the link', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ team_id: `${COMMUNITY}//` }))
    await send(post())
    expect(handedOff().sourceUrl).toBe(`${COMMUNITY}/posts/42`)
  })

  it.each([
    ['another host', 'https://elsewhere.example/c/general/billing-question'],
    ['a host that only starts with the community host', 'https://community.example.elsewhere.example/p'],
    ['plain http on the community host', 'http://community.example/c/general/billing-question'],
    ['a non-web scheme', 'javascript:void(0)'],
    ['a value that is not a url', 'not a url'],
  ])('uses the built link instead of a payload url on %s', async (_label, url) => {
    await send(post({ url }))
    expect(handedOff().sourceUrl).toBe(`${COMMUNITY}/posts/42`)
  })

  it('leaves the link out when no community url is saved and the payload url cannot be checked', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ team_id: null }))
    await send(post({ url: 'https://community.example/c/general/billing-question' }))
    expect(handedOff().sourceUrl).toBeUndefined()
  })
})

describe('Circle webhook: Admin API token', () => {
  it('passes the stored token to the lookup as the integration row holds it', async () => {
    h.fetchCircleRecord.mockResolvedValue({ ok: true, record: { id: 42, body: LONG, user_id: 4, space_id: 2 } })
    await send({ post: { id: 42, user_id: 4, space_id: 2 } })
    expect(h.fetchCircleRecord).toHaveBeenCalledWith('circle-api-token', 'post', '42')
    expect(h.decryptToken).not.toHaveBeenCalled()
  })

  it('skips the lookup when no token is stored', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ bot_token: null }))
    const res = await send({ post: { id: 42, user_id: 4, space_id: 2 } })
    expect(res.status).toBe(200)
    expect(h.fetchCircleRecord).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })
})

// answerLoops's own comments come back through the "Posted a comment"
// Workflow like any other. They are recognised by the comment id stored when
// the reply was posted, or by the member the replies are posted as.
describe('Circle webhook: answerLoops’s own replies', () => {
  const ownReplyLog = () => droppedLog()?.[1]

  it('skips a comment whose id answerLoops stored when it posted the reply', async () => {
    h.isPostedByAnswerLoops.mockResolvedValue(true)
    const res = await send(comment())
    expect(res.status).toBe(200)
    expect(h.isPostedByAnswerLoops).toHaveBeenCalledWith('circle-comment-9', 6, 'circle')
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
    expect(ownReplyLog()).toMatchObject({ orgId: 6, kind: 'comment', id: '9', reason: 'own reply' })
  })

  // The posting member is often a real person: with "post replies as" blank,
  // replies go out as the token's admin. A comment by that member which isn't
  // one answerLoops posted is something they wrote by hand, so it stays on the
  // ticket as team context instead of being thrown away.
  it('keeps a hand-written comment by the member id Circle reported for answerLoops’s replies as team context', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ bot_user_id: '31' }))
    const res = await send(comment({ user_id: 31 }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'circle-comment-9', platform: 'circle' }),
      6
    )
  })

  it('keeps a hand-written comment by the "post replies as" member, matched by email ignoring case, as team context', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ bot_username: 'support@example.com' }))
    const res = await send(comment({ user_email: 'Support@Example.com' }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'circle-comment-9' }), 6)
  })

  it('drops a comment by the posting member when its id is one answerLoops posted', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ bot_user_id: '31' }))
    h.isPostedByAnswerLoops.mockResolvedValue(true)
    await send(comment({ user_id: 31 }))
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
    expect(ownReplyLog()).toMatchObject({ reason: 'own reply' })
  })

  it('skips an own short comment before the length check, so it is logged as an own reply', async () => {
    h.isPostedByAnswerLoops.mockResolvedValue(true)
    await send(comment({ body: 'Thanks!' }))
    expect(ownReplyLog()).toMatchObject({ reason: 'own reply' })
  })

  it('ingests a comment from anyone else', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ bot_user_id: '31', bot_username: 'support@example.com' }))
    const res = await send(comment({ user_id: 4, user_email: 'erin@example.com' }))
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })

  it('treats a post by the posting member like a team member’s post, opening no ticket', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(integration({ bot_user_id: '4' }))
    await send(post())
    expect(h.isPostedByAnswerLoops).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ kind: 'post', reason: 'team member' })
  })
})

// Comments from the team member ids saved on the card are part of the
// conversation staff read, never a support request.
describe('Circle webhook: team members', () => {
  beforeEach(() => {
    h.parseTeamMemberIds.mockReturnValue(['4'])
  })

  it('keeps a team member’s comment on a tracked post as thread context, with no ticket', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 70 })
    const res = await send(comment())
    expect(res.status).toBe(200)
    expect(h.recordThreadContextMessage).toHaveBeenCalledWith(
      { messageId: 'circle-comment-9', content: LONG, authorName: 'erin', threadId: '42', platform: 'circle' },
      6
    )
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('keeps a short team comment too, since it belongs to a tracked conversation', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 70 })
    await send(comment({ body: 'On it!' }))
    expect(h.recordThreadContextMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'On it!' }), 6)
  })

  it('acknowledges a team member’s comment on a post with no ticket without opening one', async () => {
    h.recordThreadContextMessage.mockResolvedValue(false)
    const res = await send(comment())
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ kind: 'comment', id: '9', reason: 'team member' })
  })

  it('does not open a ticket for a team member’s post', async () => {
    const res = await send(post())
    expect(res.status).toBe(200)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
    expect(droppedLog()?.[1]).toMatchObject({ kind: 'post', id: '42', reason: 'team member' })
  })

  it('ingests comments from members not on the list', async () => {
    h.parseTeamMemberIds.mockReturnValue(['5', '6'])
    await send(comment())
    expect(h.recordThreadContextMessage).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)
  })
})
