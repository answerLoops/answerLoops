import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { auth, getBoardSnapshot } = vi.hoisted(() => ({
  auth: vi.fn(),
  getBoardSnapshot: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/db/queries/product-feedback', () => ({ getBoardSnapshot }))

import { GET } from '@/app/api/product-feedback/route'

const SNAPSHOT = { feedback: [], updates: [] }

describe('GET /api/product-feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBoardSnapshot.mockResolvedValue(SNAPSHOT)
    auth.mockResolvedValue({ user: { id: '42' } })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('404s when the flag is off, without touching auth or the database', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', '')
    const res = await GET()
    expect(res.status).toBe(404)
    expect(auth).not.toHaveBeenCalled()
    expect(getBoardSnapshot).not.toHaveBeenCalled()
  })

  it('requires a signed-in user: 401 without a session, before any query', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    auth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(getBoardSnapshot).not.toHaveBeenCalled()
  })

  it.each(['abc', '0', '-3', '1.5', ''])('401s a session whose user id is %j', async (id) => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    auth.mockResolvedValue({ user: { id } })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(getBoardSnapshot).not.toHaveBeenCalled()
  })

  it('returns the viewer-scoped snapshot, uncached, for a signed-in user', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', '1')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual(SNAPSHOT)
    expect(getBoardSnapshot).toHaveBeenCalledWith({ userId: 42 })
  })
})
