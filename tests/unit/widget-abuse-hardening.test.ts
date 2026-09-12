import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Widget chat is a public, unauthenticated endpoint that calls a paid AI
// model, so its cost controls have to hold on their own and stay in place.
//
// It uses the shared lib/ratelimit.ts limiter (as ingest and KB upload do)
// rather than a one-off: a per-token limit that caps total cost exposure per
// org regardless of IP, alongside the per-IP one, since an IP is not a
// reliable identity. Per-message length and message-array size are both
// capped before the request reaches the model.
//
// Source-file structural assertions — same convention as
// tenant-isolation.test.ts; e2e/widget.spec.ts exercises the actual HTTP
// behavior (400s, 429, streamed response).

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('widget chat route reuses the shared rate limiter', () => {
  it('uses the shared limiter from lib/ratelimit instead of a hand-rolled Map', () => {
    const src = read('app/api/widget/chat/route.ts')
    // Moved from the in-process rateLimit to rateLimitShared: the Map-backed
    // limiter's real ceiling was TOKEN_MAX x instance count and reset on every
    // redeploy, so the documented per-token limit was not the enforced one.
    expect(src).toContain("import { rateLimitShared } from '@/lib/ratelimit'")
    expect(src).not.toContain('rateLimitMap')
    expect(src).not.toContain('function checkRateLimit')
  })

  it('rate-limits both by widget token and by token+IP', () => {
    const src = read('app/api/widget/chat/route.ts')
    expect(src).toMatch(/rateLimitShared\(`widget-token:\$\{widgetToken\}`, TOKEN_MAX, TOKEN_WINDOW_MS\)/)
    expect(src).toMatch(/rateLimitShared\(`widget-ip:\$\{widgetToken\}:\$\{ip\}`, IP_TOKEN_MAX, IP_TOKEN_WINDOW_MS\)/)
  })

  it('rejects with 429 when either limiter trips', () => {
    const src = read('app/api/widget/chat/route.ts')
    const matches = src.match(/status: 429/g) ?? []
    expect(matches.length).toBe(2)
  })
})

describe('widget chat route caps input size before calling the model', () => {
  it('defines a per-message character cap and a max message count', () => {
    const src = read('app/api/widget/chat/route.ts')
    expect(src).toContain('const MAX_MESSAGE_CHARS = 4_000')
    expect(src).toContain('const MAX_MESSAGES = 50')
  })

  it('rejects oversized message arrays and oversized message text before the model call', () => {
    const src = read('app/api/widget/chat/route.ts')
    const capIdx = src.indexOf('messages.length > MAX_MESSAGES')
    const oversizedIdx = src.indexOf('const oversized =')
    const streamIdx = src.indexOf('widgetAgent.stream(')
    expect(capIdx).toBeGreaterThan(-1)
    expect(oversizedIdx).toBeGreaterThan(-1)
    expect(streamIdx).toBeGreaterThan(capIdx)
    expect(streamIdx).toBeGreaterThan(oversizedIdx)
  })
})
