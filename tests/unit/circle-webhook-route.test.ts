import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Infra tests for the new Circle.so ingest-only channel API route. Source-file
// assertions only — Next.js route modules cannot be imported in vitest
// (matches tests/unit/discourse-webhook-route.test.ts). These lock in the
// security-critical shape of the inbound webhook: it resolves the org from a
// per-org secret (header OR ?token= fallback), rejects anything that is not an
// enabled Circle integration BEFORE touching the pipeline, only ever hands off
// with platform 'circle', keeps the spam/space filters, and — because Circle
// is ingest-only — never imports or calls a Circle *send* function (there is
// none in lib/circle/client.ts either).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('Circle inbound webhook route', () => {
  const src = readSrc('app/api/circle/webhook/route.ts')

  it('exists and exports POST', () => {
    expect(src).toContain('export async function POST')
  })

  it('reads the per-org secret from the x-answerloops-token header AND a ?token= query param', () => {
    expect(src.toLowerCase()).toContain('x-answerloops-token')
    expect(src).toMatch(/searchParams\.get\(['"]token['"]\)/)
  })

  it('resolves the org via getIntegrationByBotSecret and asserts platform+enabled before processing', () => {
    expect(src).toContain('getIntegrationByBotSecret')
    const gateIdx = src.indexOf("integration.platform !== 'circle'")
    const enabledIdx = src.indexOf('integration.enabled !== 1')
    const processIdx = src.indexOf('processCommunityMessage(')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(enabledIdx).toBeGreaterThan(-1)
    // The 401 gate must come before the pipeline hand-off.
    expect(gateIdx).toBeLessThan(processIdx)
    expect(enabledIdx).toBeLessThan(processIdx)
  })

  it('rejects a missing/mismatched token with 401', () => {
    expect(src).toContain("status: 401")
  })

  it('hands off to the shared ingest pipeline only with platform circle', () => {
    expect(src).toContain('processCommunityMessage')
    expect(src).toContain("platform: 'circle'")
    // no other platform string is passed from this route
    expect(src).not.toMatch(/platform: '(?!circle')[a-z_]+'/)
  })

  it('keeps the watched-space, min-length and author filters', () => {
    expect(src).toContain('parseChannelIds')
    expect(src).toContain('content.spaceId')
    expect(src).toMatch(/content\.body\.length < 10/)
    expect(src).toMatch(/content\.authorId/)
    expect(src).toMatch(/=== '0'/)
  })

  it('enrichment fallback references decryptToken + fetchCirclePost/fetchCircleComment', () => {
    expect(src).toContain('decryptToken')
    expect(src).toContain('fetchCirclePost')
    expect(src).toContain('fetchCircleComment')
  })

  it('never imports a Circle send/post function (Circle is ingest-only)', () => {
    expect(src).not.toMatch(/import[^\n]*from '@\/lib\/circle\/send'/)
    expect(src).not.toMatch(/sendToCircle|postToCircle|createCirclePost|postCircle/)
  })

  it('reads an explicit ?kind= param and treats it as authoritative over guessing', () => {
    expect(src).toMatch(/searchParams\.get\(['"]kind['"]\)/)
    expect(src).toContain('explicitKind')
    // pickRecord must accept it as a second argument, not just the body.
    expect(src).toMatch(/pickRecord\(\s*body\s*,\s*explicitKind\s*\)/)
  })

  it('does not classify a generic record as a post just because post_id is absent', () => {
    // Known Issue #117: a comment payload nested under record/data with none
    // of the comment-only keys used to fall through to 'post'. The fix must
    // check more than a single hardcoded 'post_id' key.
    expect(src).toContain('COMMENT_ONLY_KEYS')
    const keysMatch = src.match(/COMMENT_ONLY_KEYS\s*=\s*\[([^\]]+)\]/)
    expect(keysMatch).not.toBeNull()
    const keys = keysMatch![1]
    expect(keys).toMatch(/post_id/)
    expect(keys).toMatch(/parent_id|parentId|parent_post_id/)
  })

  it('trusts body.comment / body.post directly without running them through the guess heuristic', () => {
    const commentIdx = src.indexOf("if (body.comment) return { raw: body.comment, kind: 'comment' }")
    const postIdx = src.indexOf("if (body.post) return { raw: body.post, kind: 'post' }")
    const guessIdx = src.indexOf('looksLikeComment(generic, eventStr)')
    expect(commentIdx).toBeGreaterThan(-1)
    expect(postIdx).toBeGreaterThan(-1)
    expect(guessIdx).toBeGreaterThan(-1)
    expect(commentIdx).toBeLessThan(guessIdx)
    expect(postIdx).toBeLessThan(guessIdx)
  })

  it('logs (without the secret value) when auth falls back to the query-string token', () => {
    expect(src).toContain('headerSecret')
    const logIdx = src.indexOf('authenticated via ?token=')
    expect(logIdx).toBeGreaterThan(-1)
    // The log call must never interpolate the resolved secret itself.
    const logCallEnd = src.indexOf('})', logIdx)
    const logCall = src.slice(logIdx - 40, logCallEnd)
    expect(logCall).not.toMatch(/\bsecret\b(?!Secret)/)
  })
})

describe('lib/circle/client.ts has no write path', () => {
  const src = readSrc('lib/circle/client.ts')

  it('exports no write/post-creating function', () => {
    const exportedNames = [...src.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])
    for (const name of exportedNames) {
      expect(name).not.toMatch(/^(send|post|create|reply|update|delete)/i)
    }
  })

  it('only ever issues GET requests via circleFetch (no method: POST/PUT/...)', () => {
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/)
  })
})
