import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/circle/send.ts's postToCirclePost is the write side of the Circle
// channel: it adds a comment to the post a ticket came from, using the saved
// Admin API token. It never throws, so a Circle outage can't break the
// approve/send actions or the auto-answer path that call it.

let mockExternals = false
vi.mock('@/lib/mock-mode', () => ({
  get MOCK_EXTERNALS() {
    return mockExternals
  },
}))

const h = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  setIntegrationBotUserId: vi.fn(),
  fetch: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegration: h.getIntegration,
  setIntegrationBotUserId: h.setIntegrationBotUserId,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: h.warn, error: h.error, debug: vi.fn() } }))

const TOKEN = 'circle-admin-token-value'
const integration = (over: Record<string, unknown> = {}) => ({
  bot_token: TOKEN,
  bot_username: null,
  bot_user_id: null,
  team_id: 'https://community.example',
  ...over,
})

const okResponse = (body: unknown) => ({ ok: true, status: 201, json: async () => body })

beforeEach(() => {
  vi.clearAllMocks()
  mockExternals = false
  h.getIntegration.mockResolvedValue(integration())
  h.fetch.mockResolvedValue(okResponse({ id: 777, user_id: 31 }))
  vi.stubGlobal('fetch', h.fetch)
})

/** Every argument any logger call received, flattened to one string. */
const everythingLogged = () => JSON.stringify([...h.error.mock.calls, ...h.warn.mock.calls])

describe('postToCirclePost', () => {
  it('MOCK_EXTERNALS: returns a mock id and never loads the integration or calls Circle', async () => {
    mockExternals = true
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'hello', 3)).toBe('mock-circle-42')
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.getIntegration).not.toHaveBeenCalled()
  })

  it('returns null without calling Circle when no Admin API token is saved', async () => {
    h.getIntegration.mockResolvedValue(integration({ bot_token: null }))
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'hello', 3)).toBeNull()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('returns null without calling Circle when Circle is not connected', async () => {
    h.getIntegration.mockResolvedValue(null)
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'hello', 3)).toBeNull()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('returns null for a post id that is not numeric, without calling Circle', async () => {
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('not-a-post', 'hello', 3)).toBeNull()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('creates a comment on the post as the token admin when no member email is saved, and returns its id', async () => {
    const { postToCirclePost } = await import('@/lib/circle/send')

    const result = await postToCirclePost('42', 'the answer', 3)

    expect(result).toBe('777')
    const [url, init] = h.fetch.mock.calls[0]
    expect(url).toBe('https://app.circle.so/api/admin/v2/comments')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(init.body)).toEqual({ post_id: 42, body: 'the answer' })
  })

  it('posts as the saved member email when one is set', async () => {
    h.getIntegration.mockResolvedValue(integration({ bot_username: 'support@example.com' }))
    const { postToCirclePost } = await import('@/lib/circle/send')

    await postToCirclePost('42', 'the answer', 3)

    expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ post_id: 42, body: 'the answer', user_email: 'support@example.com' })
  })

  it('reads the id from a response that wraps the comment', async () => {
    h.fetch.mockResolvedValue(okResponse({ comment: { id: 778, user_id: 31 } }))
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'the answer', 3)).toBe('778')
  })

  it('remembers the member id Circle posted as, so that member’s comments are recognised later', async () => {
    const { postToCirclePost } = await import('@/lib/circle/send')

    await postToCirclePost('42', 'the answer', 3)

    expect(h.setIntegrationBotUserId).toHaveBeenCalledWith(3, 'circle', '31')
  })

  it('does not rewrite the member id when it is already the one saved', async () => {
    h.getIntegration.mockResolvedValue(integration({ bot_user_id: '31' }))
    const { postToCirclePost } = await import('@/lib/circle/send')

    await postToCirclePost('42', 'the answer', 3)

    expect(h.setIntegrationBotUserId).not.toHaveBeenCalled()
  })

  it('still returns the comment id when saving the member id fails', async () => {
    h.setIntegrationBotUserId.mockRejectedValue(new Error('db down'))
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'the answer', 3)).toBe('777')
  })

  it('returns null and logs the status when Circle refuses the comment, never the token or the text', async () => {
    h.fetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({}) })
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'the private answer text', 3)).toBeNull()
    expect(h.error).toHaveBeenCalled()
    expect(h.error.mock.calls[0][1]).toMatchObject({ status: 422, postId: '42', orgId: 3 })
    expect(everythingLogged()).not.toContain(TOKEN)
    expect(everythingLogged()).not.toContain('the private answer text')
  })

  it('returns null instead of throwing when Circle cannot be reached', async () => {
    h.fetch.mockRejectedValue(new TypeError('fetch failed'))
    const { postToCirclePost } = await import('@/lib/circle/send')

    await expect(postToCirclePost('42', 'the answer', 3)).resolves.toBeNull()
    expect(h.error).toHaveBeenCalled()
    expect(everythingLogged()).not.toContain(TOKEN)
  })

  it('returns null instead of throwing when loading the integration fails', async () => {
    h.getIntegration.mockRejectedValue(new Error('db down'))
    const { postToCirclePost } = await import('@/lib/circle/send')

    await expect(postToCirclePost('42', 'the answer', 3)).resolves.toBeNull()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('returns null when Circle answers OK with a body that has no comment id', async () => {
    h.fetch.mockResolvedValue(okResponse({ success: true }))
    const { postToCirclePost } = await import('@/lib/circle/send')

    expect(await postToCirclePost('42', 'the answer', 3)).toBeNull()
  })

  it('returns null when Circle answers OK with a body that is not JSON', async () => {
    h.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } })
    const { postToCirclePost } = await import('@/lib/circle/send')

    await expect(postToCirclePost('42', 'the answer', 3)).resolves.toBeNull()
  })
})
