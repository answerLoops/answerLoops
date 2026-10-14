import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeEqual, getBearerToken, matchesPlatformBotSecret, isPlatformBotRequest } from '@/lib/http/bearer-auth'

// Every platform-wide BOT_SECRET / bearer comparison goes through these
// helpers: comparison is constant-time, and an unset or empty BOT_SECRET never
// authorizes anything (including the literal string "undefined").

const { getIntegrationByBotSecret } = vi.hoisted(() => ({ getIntegrationByBotSecret: vi.fn(async () => null) }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegrationByBotSecret }))
vi.mock('@/lib/db/queries/feedback', () => ({
  saveFeedback: vi.fn(),
  getTicketIdByAnswerMessage: vi.fn(async () => null),
}))
vi.mock('@/lib/db/queries/tickets', () => ({ claimStuckTicketForRetry: vi.fn(async () => null) }))
vi.mock('@/lib/ingest/pipeline', () => ({ runBackgroundEnrichment: vi.fn() }))
vi.mock('@/lib/db/queries/ai-config', () => ({ orgHasAIKey: vi.fn() }))
vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({
  getKbSyncJob: vi.fn(async () => null),
  finishKbSyncJob: vi.fn(),
  updateKbSyncJobProgress: vi.fn(),
}))
vi.mock('@/lib/notion/kb-sync', () => ({ syncNotionToKB: vi.fn() }))
vi.mock('@/lib/github/kb-sync', () => ({ syncRepoToKB: vi.fn(), syncDiscussionsToKB: vi.fn() }))
vi.mock('@/lib/db/queries/github', () => ({ getRepoById: vi.fn() }))


const ORIGINAL = process.env.BOT_SECRET
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BOT_SECRET
  else process.env.BOT_SECRET = ORIGINAL
})

function req(auth?: string): Request {
  return new Request('http://localhost/x', { method: 'POST', headers: auth ? { authorization: auth } : {} })
}

describe('safeEqual', () => {
  it('is true only for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })

  it('does not throw on different lengths or multi-byte input (timingSafeEqual alone would)', () => {
    expect(() => safeEqual('short', 'a-much-longer-value-than-the-first')).not.toThrow()
    expect(safeEqual('héllo', 'héllo')).toBe(true)
    expect(safeEqual('héllo', 'hello')).toBe(false)
  })

  it('is implemented on crypto.timingSafeEqual, not ===', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('lib/http/bearer-auth.ts', 'utf-8')
    expect(src).toContain('timingSafeEqual(')
  })
})

describe('getBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(getBearerToken(req('Bearer abc'))).toBe('abc')
  })
  it('returns null for a missing header, another scheme, or an empty token', () => {
    expect(getBearerToken(req())).toBeNull()
    expect(getBearerToken(req('Basic abc'))).toBeNull()
    expect(getBearerToken(req('Bearer '))).toBeNull()
    expect(getBearerToken(req('Bearer    '))).toBeNull()
  })
})

describe('matchesPlatformBotSecret — fails closed', () => {
  it('matches the configured secret', () => {
    process.env.BOT_SECRET = 'platform-secret'
    expect(matchesPlatformBotSecret('platform-secret')).toBe(true)
    expect(matchesPlatformBotSecret('platform-secreT')).toBe(false)
  })

  it('never matches when BOT_SECRET is unset, including the literal "undefined"', () => {
    delete process.env.BOT_SECRET
    expect(matchesPlatformBotSecret('undefined')).toBe(false)
    expect(matchesPlatformBotSecret('')).toBe(false)
    expect(matchesPlatformBotSecret(null)).toBe(false)
    expect(isPlatformBotRequest(req('Bearer undefined'))).toBe(false)
  })

  it('never matches when BOT_SECRET is empty', () => {
    process.env.BOT_SECRET = ''
    expect(matchesPlatformBotSecret('')).toBe(false)
    expect(matchesPlatformBotSecret('anything')).toBe(false)
    expect(isPlatformBotRequest(req('Bearer '))).toBe(false)
  })
})

describe('routes that authenticate with the platform-wide BOT_SECRET', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  const body = JSON.stringify({ message_id: 'm', vote: 'up', actor: 'a', ticket_id: 1, org_id: 1, jobId: 1 })
  const post = (url: string, auth?: string) =>
    new Request(url, { method: 'POST', body, headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' } })

  it.each([
    ['feedback', '@/app/api/feedback/route', 'http://localhost/api/feedback'],
    ['retry-stuck', '@/app/api/ingest/retry-stuck/route', 'http://localhost/api/ingest/retry-stuck'],
    ['kb sync-jobs run', '@/app/api/kb/sync-jobs/run/route', 'http://localhost/api/kb/sync-jobs/run'],
  ])('%s rejects "Bearer undefined" and an empty bearer when BOT_SECRET is unset', async (_name, mod, url) => {
    delete process.env.BOT_SECRET
    const { POST } = await import(/* @vite-ignore */ mod)
    expect((await POST(post(url, 'Bearer undefined'))).status).toBe(401)
    expect((await POST(post(url, 'Bearer '))).status).toBe(401)
    expect((await POST(post(url))).status).toBe(401)
  })

  it.each([
    ['feedback', '@/app/api/feedback/route', 'http://localhost/api/feedback'],
    ['retry-stuck', '@/app/api/ingest/retry-stuck/route', 'http://localhost/api/ingest/retry-stuck'],
    ['kb sync-jobs run', '@/app/api/kb/sync-jobs/run/route', 'http://localhost/api/kb/sync-jobs/run'],
  ])('%s rejects a wrong secret and an empty BOT_SECRET', async (_name, mod, url) => {
    process.env.BOT_SECRET = ''
    const { POST } = await import(/* @vite-ignore */ mod)
    expect((await POST(post(url, 'Bearer '))).status).toBe(401)
    process.env.BOT_SECRET = 'real-secret'
    expect((await POST(post(url, 'Bearer wrong-secret'))).status).toBe(401)
  })
})
