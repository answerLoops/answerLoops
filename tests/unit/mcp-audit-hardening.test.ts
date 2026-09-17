import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { clientIp, trustedProxyHops } from '@/lib/http/client-ip'
import { normalizeRpcId, JsonRpcErrorCode } from '@/lib/mcp/protocol'
import { GENERATION_ATTEMPT_MULTIPLIER } from '@/lib/billing/usage'

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

function req(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) }
}

describe('lib/http/client-ip: rate-limit keys must not be caller-controlled', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS
  })

  it('ignores a client-injected x-forwarded-for prefix and reads the entry the proxy appended', () => {
    // The rate-limit key must come from the entry the trusted proxy appended,
    // not the leftmost entry, so a caller cannot influence its own bucket key.
    const spoofed = clientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }))
    expect(spoofed).toBe('203.0.113.7')
    expect(spoofed).not.toBe('9.9.9.9')
  })

  it('gives a rotating spoofed prefix the same bucket key every time', () => {
    const first = clientIp(req({ 'x-forwarded-for': 'attacker-1, 203.0.113.7' }))
    const second = clientIp(req({ 'x-forwarded-for': 'attacker-2, 203.0.113.7' }))
    const third = clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.7' }))
    expect(new Set([first, second, third]).size).toBe(1)
    expect(first).toBe('203.0.113.7')
  })

  it('counts in from the right by TRUST_PROXY_HOPS when more proxies are in front', () => {
    process.env.TRUST_PROXY_HOPS = '2'
    expect(trustedProxyHops()).toBe(2)
    // client, edge-1, edge-2 -> with 2 trusted hops the real peer is edge-1's entry
    expect(clientIp(req({ 'x-forwarded-for': 'spoofed, 203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
  })

  it('defaults to one trusted hop and rejects nonsense hop counts', () => {
    expect(trustedProxyHops()).toBe(1)
    process.env.TRUST_PROXY_HOPS = '0'
    expect(trustedProxyHops()).toBe(1)
    process.env.TRUST_PROXY_HOPS = 'banana'
    expect(trustedProxyHops()).toBe(1)
  })

  it('clamps to the leftmost entry when the chain is shorter than the configured hop count', () => {
    process.env.TRUST_PROXY_HOPS = '3'
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('prefers cf-connecting-ip, which Cloudflare overwrites rather than appends', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': 'spoofed' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip, then to a constant, when no forwarding headers exist', () => {
    expect(clientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIp(req({}))).toBe('unknown')
  })

  it('is used by every rate-limited public entry point instead of raw header parsing', () => {
    for (const file of ['app/api/mcp/route.ts', 'lib/agent/http.ts', 'app/api/widget/chat/route.ts']) {
      const s = readSrc(file)
      expect(s, `${file} should resolve IP via clientIp`).toContain('clientIp(req')
      expect(s, `${file} must not read x-forwarded-for directly`).not.toContain("headers.get('x-forwarded-for')")
    }
  })
})

describe('lib/agent/http: REST surface shares the MCP rate-limit store', () => {
  const src = () => readSrc('lib/agent/http.ts')

  it('uses the Postgres-backed limiter, so a key cannot dodge its org quota by switching surfaces', () => {
    const s = src()
    expect(s).toContain('await rateLimitShared(`agent-ip:${ip}`')
    expect(s).toContain('await rateLimitShared(`agent:${orgId}`')
    // The in-process limiter must be gone from this file entirely — its
    // ceiling is per-instance and resets on restart.
    expect(s).not.toContain("import { rateLimit }")
  })

  it('returns keyId alongside orgId so callers can attribute usage to a credential', () => {
    expect(src()).toContain('return { orgId, keyId, scopes, rateLimitHeaders:')
  })
})

describe('429 responses carry Retry-After', () => {
  it('MCP route sends a distinct rate-limit code and a Retry-After header', () => {
    const s = readSrc('app/api/mcp/route.ts')
    expect(s).toContain("'Retry-After': String(seconds)")
    expect(s).toContain('JsonRpcErrorCode.RATE_LIMITED')
    // The old behaviour reported throttling as an internal error, which tells
    // a client to alert rather than back off.
    expect(s).not.toContain("JsonRpcErrorCode.INTERNAL_ERROR, 'Rate limit exceeded'")
  })

  it('Agent REST gate sends a Retry-After header too', () => {
    const s = readSrc('lib/agent/http.ts')
    expect(s).toContain("'Retry-After': String(seconds)")
  })

  it('RATE_LIMITED is its own JSON-RPC code, distinct from INTERNAL_ERROR', () => {
    expect(JsonRpcErrorCode.RATE_LIMITED).toBe(-32002)
    expect(JsonRpcErrorCode.RATE_LIMITED).not.toBe(JsonRpcErrorCode.INTERNAL_ERROR)
  })
})

describe('lib/mcp/protocol: JSON-RPC id normalization', () => {
  it('passes through the types JSON-RPC 2.0 allows', () => {
    expect(normalizeRpcId('abc')).toBe('abc')
    expect(normalizeRpcId(42)).toBe(42)
    expect(normalizeRpcId(null)).toBe(null)
  })

  it('refuses to echo back an arbitrary object or array the caller supplied', () => {
    expect(normalizeRpcId({ evil: 'payload' })).toBe(null)
    expect(normalizeRpcId(['a', 'b'])).toBe(null)
    expect(normalizeRpcId(undefined)).toBe(null)
  })

  it('the MCP route normalizes before using the id', () => {
    const s = readSrc('app/api/mcp/route.ts')
    expect(s).toContain('const id = normalizeRpcId(body.id)')
    expect(s).not.toContain('const id = body.id ?? null')
  })
})

describe('app/api/mcp/route: protocol version negotiation', () => {
  it('rejects a pinned version this server does not implement instead of ignoring the header', () => {
    const s = readSrc('app/api/mcp/route.ts')
    expect(s).toContain("req.headers.get('mcp-protocol-version')")
    expect(s).toContain('SUPPORTED_PROTOCOL_VERSIONS')
    expect(s).toContain('Unsupported MCP-Protocol-Version')
  })
})

describe('generate_answer: total attempts are capped, not just billed deflections', () => {
  it('exposes a multiplier over the plan deflection allowance', () => {
    expect(GENERATION_ATTEMPT_MULTIPLIER).toBeGreaterThan(1)
  })

  it('core gates on both ceilings before any LLM call, in one reservation', () => {
    const s = readSrc('lib/agent/core.ts')
    const fnStart = s.indexOf('export async function generateAnswerCore')
    const fnBody = s.slice(fnStart)
    const reserveIdx = fnBody.indexOf('reserveGeneration(orgId, keyId)')
    const llmIdx = fnBody.indexOf('answerAgent.generate(')
    expect(reserveIdx).toBeGreaterThan(-1)
    expect(reserveIdx).toBeLessThan(llmIdx)
    // Both refusal reasons must be handled, or one ceiling silently stops
    // rejecting once they share a single call.
    expect(fnBody).toContain("reservation.reason === 'deflection-limit'")
    expect(fnBody).toContain('attempt limit reached')
  })

  it('both ceilings are evaluated under a per-org lock, in the same transaction as the write', () => {
    const s = readSrc('lib/billing/usage.ts')
    const fnStart = s.indexOf('export async function reserveGeneration')
    const fnBody = s.slice(fnStart)
    const txIdx = fnBody.indexOf('transaction(')
    const lockIdx = fnBody.indexOf('pg_advisory_xact_lock')
    const deflectionIdx = fnBody.indexOf('countDeflections(')
    const attemptIdx = fnBody.indexOf('countAttempts(')
    // Search from attemptIdx, not function start — self-hosted deployments
    // (no Stripe configured) skip metering entirely via an early-return that
    // itself calls reserveApiGeneration(), before the locked/metered path
    // this test is pinning even begins.
    const insertIdx = fnBody.indexOf('reserveApiGeneration(', attemptIdx)
    expect(txIdx).toBeGreaterThan(-1)
    // The lock must be taken first, and both counts plus the insert must sit
    // inside it. A count outside the lock can be stale by the time it is used.
    expect(lockIdx).toBeGreaterThan(txIdx)
    expect(deflectionIdx).toBeGreaterThan(lockIdx)
    expect(attemptIdx).toBeGreaterThan(lockIdx)
    expect(insertIdx).toBeGreaterThan(attemptIdx)
  })

  it('promotion re-checks the deflection limit under the same lock', () => {
    const s = readSrc('lib/billing/usage.ts')
    const fnStart = s.indexOf('export async function commitDeflection')
    const fnBody = s.slice(fnStart)
    const lockIdx = fnBody.indexOf('pg_advisory_xact_lock')
    const countIdx = fnBody.indexOf('countDeflections(')
    const billIdx = fnBody.indexOf('markApiGenerationBilled(generationId, tx)')
    expect(lockIdx).toBeGreaterThan(-1)
    // Confidence is only known after the model returns, so several reservations
    // can each turn out billable. Without this re-check the org is billed past
    // the plan limit.
    expect(countIdx).toBeGreaterThan(lockIdx)
    expect(billIdx).toBeGreaterThan(countIdx)
  })

  it('counts every call, not only high-confidence ones — otherwise the ceiling never moves', () => {
    const s = readSrc('lib/db/queries/api-generations.ts')
    const fnStart = s.indexOf('export async function getMonthlyApiGenerationAttempts')
    const fnBody = s.slice(fnStart, fnStart + 700)
    expect(fnBody).not.toContain('highConfidence')
  })

  it('unlimited plans are not given an attempt ceiling', () => {
    const s = readSrc('lib/billing/usage.ts')
    const fnStart = s.indexOf('export async function reserveGeneration')
    const fnBody = s.slice(fnStart)
    // Both ceilings sit behind the same null check, so an unlimited plan is
    // never counted against either one.
    expect(fnBody).toContain('if (plan.deflectionsPerMonth !== null) {')
    const guardIdx = fnBody.indexOf('if (plan.deflectionsPerMonth !== null) {')
    expect(fnBody.indexOf('GENERATION_ATTEMPT_MULTIPLIER')).toBeGreaterThan(guardIdx)
  })
})

describe('per-key usage attribution', () => {
  it('api_generations records which key drove the call', () => {
    const schema = readSrc('lib/db/schema.ts')
    expect(schema).toContain("keyId: integer('key_id').references(() => apiKeys.id)")
    const migration = readSrc('drizzle/0019_api_generation_key_attribution.sql')
    expect(migration).toContain('ALTER TABLE api_generations ADD COLUMN IF NOT EXISTS key_id')
    expect(migration).toContain('REFERENCES api_keys(id)')
  })

  it('keyId is threaded from the route through tools into the usage write', () => {
    expect(readSrc('app/api/mcp/route.ts')).toContain('callMcpTool(toolName, toolArgs, orgId, keyId)')
    expect(readSrc('lib/mcp/tools.ts')).toContain('generateAnswerCore(orgId, args, keyId)')
    expect(readSrc('lib/agent/core.ts')).toContain('reserveGeneration(orgId, keyId)')
    expect(readSrc('app/api/v1/agent/answers/route.ts')).toContain('generateAnswerCore(auth.orgId, bodyResult.body, auth.keyId)')
  })

  it('the tool-call log line carries keyId so traffic can be traced to a credential', () => {
    expect(readSrc('app/api/mcp/route.ts')).toContain('orgId, keyId, tool: toolName')
  })
})

describe('lib/ratelimit: stale bucket rows are swept on a guaranteed interval', () => {
  it('sweeps on a time interval rather than a per-call probability', () => {
    const s = readSrc('lib/ratelimit.ts')
    expect(s).toContain('CLEANUP_INTERVAL_MS')
    expect(s).toContain('now.getTime() >= nextCleanupAt')
    // A 1% chance leaves growth unbounded in the tail when keys are derived
    // from request input.
    expect(s).not.toContain('CLEANUP_CHANCE')
    expect(s).not.toContain('Math.random() < ')
  })

  it('advances the next-sweep timestamp before firing, so concurrent calls do not each issue a DELETE', () => {
    const s = readSrc('lib/ratelimit.ts')
    const guardIdx = s.indexOf('now.getTime() >= nextCleanupAt')
    const advanceIdx = s.indexOf('nextCleanupAt = now.getTime() + CLEANUP_INTERVAL_MS')
    const deleteIdx = s.indexOf('DELETE FROM rate_limit_buckets')
    expect(advanceIdx).toBeGreaterThan(guardIdx)
    expect(advanceIdx).toBeLessThan(deleteIdx)
  })
})

describe('API key management is owner/admin only and membership-verified', () => {
  it('both key actions go through requireOrgAccess with a role gate', () => {
    const s = readSrc('app/actions/api-keys.ts')
    expect(s).toContain("const KEY_ADMIN_ROLES = ['owner', 'admin'] as const")
    const gates = [...s.matchAll(/requireOrgAccess\(KEY_ADMIN_ROLES\)/g)]
    expect(gates.length).toBe(2)
    // The old session-only check let any member mint org-wide credentials.
    expect(s).not.toContain("if (!session?.user) return { error: 'Unauthorized' }")
  })

  it('no key surface falls back to a default org id', () => {
    for (const file of ['app/actions/api-keys.ts', 'app/api/api-keys/route.ts']) {
      expect(readSrc(file), file).not.toContain('DEFAULT_ORG_ID')
    }
  })

  it('requireOrgAccess proves membership from the database rather than trusting the session', () => {
    const s = readSrc('lib/auth/org.ts')
    expect(s).toContain('.from(memberships)')
    expect(s).toContain('eq(memberships.userId, userId)')
    expect(s).toContain('eq(memberships.orgId, orgId)')
    expect(s).toContain("if (!membership) return { ok: false, error: 'Unauthorized' }")
  })

  it('rejects a role outside the allowed set', () => {
    const s = readSrc('lib/auth/org.ts')
    expect(s).toContain('if (allowedRoles && !allowedRoles.includes(role))')
  })

  it('the key list endpoint reports whether the viewer may manage keys', () => {
    const s = readSrc('app/api/api-keys/route.ts')
    expect(s).toContain('can_manage: KEY_ADMIN_ROLES.includes(access.role)')
  })
})

describe('lib/http/origin-guard: proxy-supplied client-IP header must not be spoofable by bypassing the edge proxy', () => {
  afterEach(() => {
    delete process.env.ORIGIN_VERIFY_SECRET
  })

  it('passes every request through when no secret is configured', async () => {
    const { verifyOriginProxy, originVerifyConfigured } = await import('@/lib/http/origin-guard')
    expect(originVerifyConfigured()).toBe(false)
    expect(verifyOriginProxy(req({}))).toBeNull()
    expect(verifyOriginProxy(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBeNull()
  })

  it('rejects a request missing the header once a secret is configured', async () => {
    process.env.ORIGIN_VERIFY_SECRET = 'test-secret'
    const { verifyOriginProxy, originVerifyConfigured } = await import('@/lib/http/origin-guard')
    expect(originVerifyConfigured()).toBe(true)
    const rejection = verifyOriginProxy(req({ 'cf-connecting-ip': '203.0.113.7' }))
    expect(rejection).not.toBeNull()
    expect(rejection!.status).toBe(403)
  })

  it('rejects a request carrying the wrong secret', async () => {
    process.env.ORIGIN_VERIFY_SECRET = 'test-secret'
    const { verifyOriginProxy } = await import('@/lib/http/origin-guard')
    const rejection = verifyOriginProxy(req({ 'x-origin-verify': 'wrong-secret' }))
    expect(rejection?.status).toBe(403)
  })

  it('passes a request carrying the matching secret', async () => {
    process.env.ORIGIN_VERIFY_SECRET = 'test-secret'
    const { verifyOriginProxy } = await import('@/lib/http/origin-guard')
    expect(verifyOriginProxy(req({ 'x-origin-verify': 'test-secret' }))).toBeNull()
  })

  it('every public pre-auth POST route checks the origin before trusting clientIp', () => {
    for (const file of ['app/api/mcp/route.ts', 'lib/agent/http.ts', 'app/api/widget/chat/route.ts']) {
      const s = readSrc(file)
      expect(s, `${file} should call verifyOriginProxy`).toContain('verifyOriginProxy(')
    }
  })
})
