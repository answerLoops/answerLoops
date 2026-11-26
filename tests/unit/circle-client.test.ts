import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/circle/client.ts is the read-only Circle Admin v2 client. Two pure-ish
// pieces matter:
//   - normalizeCircleContent maps an untyped post/comment (from the
//     non-contractual Workflow webhook OR the API) into CircleContent. A
//     regression in the field mapping silently drops the author, the space
//     (breaking the watched-space filter), or — for a comment — points the
//     ticket thread at the comment instead of its parent post.
//   - circleFetch must send `Authorization: Bearer <token>` against the v2
//     base; fetchCircleRecord must be inert under MOCK_EXTERNALS (no network in
//     tests / CI), mirroring tests/unit/discourse-send-routing.test.ts.

let mockExternals = false
vi.mock('@/lib/mock-mode', () => ({
  get MOCK_EXTERNALS() {
    return mockExternals
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockExternals = false
})

describe('normalizeCircleContent', () => {
  it('maps a post shape and joins name + body', async () => {
    const { normalizeCircleContent } = await import('@/lib/circle/client')
    const out = normalizeCircleContent(
      { id: 55, name: 'Login broken', body: 'I cannot sign in', space_id: 9, user_id: 3, user_name: 'Ada' },
      'post'
    )
    expect(out).toEqual({
      id: '55',
      body: 'Login broken\n\nI cannot sign in',
      authorId: '3',
      authorName: 'Ada',
      authorEmail: null,
      spaceId: '9',
      postId: '55',
      url: null,
    })
  })

  it('reads the author email when the payload carries one', async () => {
    const { normalizeCircleContent } = await import('@/lib/circle/client')
    const out = normalizeCircleContent({ id: 900, body: 'a reply', post_id: 55, user_id: 4, user_email: ' ada@example.com ' }, 'comment')
    expect(out?.authorEmail).toBe('ada@example.com')
  })

  it('builds the ingest message id for a post or comment', async () => {
    const { circleMessageId } = await import('@/lib/circle/client')
    expect(circleMessageId('post', '55')).toBe('circle-post-55')
    expect(circleMessageId('comment', '900')).toBe('circle-comment-900')
  })

  it('extracts body when it arrives as a { body: string } object', async () => {
    const { normalizeCircleContent } = await import('@/lib/circle/client')
    const out = normalizeCircleContent({ id: 1, body: { body: 'nested text' } }, 'post')
    expect(out?.body).toBe('nested text')
  })

  it('for a comment, postId is the parent post_id and id is the comment id', async () => {
    const { normalizeCircleContent } = await import('@/lib/circle/client')
    const out = normalizeCircleContent(
      { id: 900, body: 'a reply', post_id: 55, user_id: 4 },
      'comment'
    )
    expect(out?.id).toBe('900')
    expect(out?.postId).toBe('55')
  })

  it('returns null when the record has no id', async () => {
    const { normalizeCircleContent } = await import('@/lib/circle/client')
    expect(normalizeCircleContent({ body: 'orphan' }, 'post')).toBeNull()
  })
})

describe('circleFetch', () => {
  it('sets Authorization: Bearer <token> and hits the Admin v2 base', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    const { circleFetch } = await import('@/lib/circle/client')

    await circleFetch('a-circle-admin-token', '/posts/42')

    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://app.circle.so/api/admin/v2/posts/42')
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer a-circle-admin-token')
  })
})

describe('fetchCircleRecord', () => {
  const jsonResponse = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

  it('is off under MOCK_EXTERNALS without calling fetch', async () => {
    mockExternals = true
    global.fetch = vi.fn()
    const { fetchCircleRecord } = await import('@/lib/circle/client')
    expect(await fetchCircleRecord('tok', 'post', '42')).toEqual({ ok: false, reason: 'off' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the post or comment from the matching endpoint', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ id: 42, body: 'Full text' }))
    const { fetchCircleRecord } = await import('@/lib/circle/client')
    expect(await fetchCircleRecord('tok', 'post', '42')).toEqual({ ok: true, record: { id: 42, body: 'Full text' } })
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://app.circle.so/api/admin/v2/posts/42')
    await fetchCircleRecord('tok', 'comment', '7')
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe('https://app.circle.so/api/admin/v2/comments/7')
  })

  it('reports the status of a refused lookup', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ error: 'nope' }, 401))
    const { fetchCircleRecord } = await import('@/lib/circle/client')
    expect(await fetchCircleRecord('tok', 'post', '42')).toEqual({ ok: false, reason: 'status', status: 401 })
  })

  it('reports an unreachable API instead of throwing, for a timeout or a network error', async () => {
    const { fetchCircleRecord } = await import('@/lib/circle/client')
    global.fetch = vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError') })
    await expect(fetchCircleRecord('tok', 'post', '42')).resolves.toEqual({ ok: false, reason: 'unreachable' })
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed') })
    await expect(fetchCircleRecord('tok', 'comment', '7')).resolves.toEqual({ ok: false, reason: 'unreachable' })
  })

  it('reports a response that is not a record', async () => {
    const { fetchCircleRecord } = await import('@/lib/circle/client')
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }) as unknown as Response)
    expect(await fetchCircleRecord('tok', 'post', '42')).toEqual({ ok: false, reason: 'invalid' })
    global.fetch = vi.fn(async () => jsonResponse(['not', 'a', 'record']))
    expect(await fetchCircleRecord('tok', 'post', '42')).toEqual({ ok: false, reason: 'invalid' })
  })
})
