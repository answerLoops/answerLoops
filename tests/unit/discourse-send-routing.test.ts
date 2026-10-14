import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/discourse/send.ts's postToDiscourseTopic is the write side of the
// Discourse channel. It has three distinct exits and every one matters:
//   - MOCK_EXTERNALS on  -> returns `mock-discourse-<id>`, never touches fetch
//   - integration missing creds -> returns null, never touches fetch
//   - fully configured -> POSTs `{siteUrl}/posts.json` with Api-Key /
//     Api-Username headers and a `{topic_id, raw}` body, returns the new id
// The creds are read from three reused generic columns (bot_token = api key,
// team_id = site url, bot_username = the forum account), so a regression that
// swaps any of those would silently post as the wrong user or to nowhere.

let mockExternals = false
vi.mock('@/lib/mock-mode', () => ({
  get MOCK_EXTERNALS() {
    return mockExternals
  },
}))

const { getIntegration, safeFetch } = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  safeFetch: vi.fn(),
}))
// The site URL is tenant-supplied, so Discourse calls go through safeFetch.
vi.mock('@/lib/http/safe-fetch', () => ({ safeFetch }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration }))

const FULL_INTEGRATION = {
  bot_token: 'a-discourse-admin-api-key',
  team_id: 'https://forum.example.com',
  bot_username: 'support-bot',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExternals = false
  getIntegration.mockResolvedValue(FULL_INTEGRATION)
  safeFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ id: 987 }),
    text: async () => '',
  })
})

describe('postToDiscourseTopic', () => {
  it('MOCK_EXTERNALS: returns a mock id and never calls fetch', async () => {
    mockExternals = true
    const { postToDiscourseTopic } = await import('@/lib/discourse/send')

    const result = await postToDiscourseTopic('42', 'hello', 3)

    expect(result).toBe('mock-discourse-42')
    expect(safeFetch).not.toHaveBeenCalled()
    expect(getIntegration).not.toHaveBeenCalled()
  })

  it('returns null and does not call fetch when the integration is missing', async () => {
    getIntegration.mockResolvedValue(null)
    const { postToDiscourseTopic } = await import('@/lib/discourse/send')

    expect(await postToDiscourseTopic('42', 'hello', 3)).toBeNull()
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('returns null when the bot username is not set (partial creds)', async () => {
    getIntegration.mockResolvedValue({ ...FULL_INTEGRATION, bot_username: null })
    const { postToDiscourseTopic } = await import('@/lib/discourse/send')

    expect(await postToDiscourseTopic('42', 'hello', 3)).toBeNull()
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('happy path: POSTs to {siteUrl}/posts.json with auth headers + topic body, returns the new post id', async () => {
    const { postToDiscourseTopic } = await import('@/lib/discourse/send')

    const result = await postToDiscourseTopic('42', 'the answer', 3)

    expect(result).toBe('987')
    const [url, init] = safeFetch.mock.calls[0]
    expect(url).toBe('https://forum.example.com/posts.json')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('Api-Key')).toBe('a-discourse-admin-api-key')
    expect(headers.get('Api-Username')).toBe('support-bot')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ topic_id: 42, raw: 'the answer' })
  })

  it('returns null when Discourse rejects the write', async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'nope' })
    const { postToDiscourseTopic } = await import('@/lib/discourse/send')

    expect(await postToDiscourseTopic('42', 'the answer', 3)).toBeNull()
  })

  it('returns null (does not throw) when the site URL is refused', async () => {
    const { UnsafeUrlError } = await import('@/lib/http/safe-url')
    safeFetch.mockRejectedValue(new UnsafeUrlError('nope'))
    const { postToDiscourseTopic } = await import('@/lib/discourse/send')

    expect(await postToDiscourseTopic('42', 'the answer', 3)).toBeNull()
  })
})
