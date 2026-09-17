import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Tests for the Agent API: the REST (non-MCP) surface for AI agents/frameworks
// that speak HTTP + OpenAPI rather than JSON-RPC. Every route wraps the same
// lib/agent/core.ts logic the MCP server wraps — see mcp-server.test.ts for
// the tests covering that shared core in depth. These tests focus on the
// REST-specific layer: auth/rate-limit wiring, route-to-core wiring, HTTP
// status codes, and the OpenAPI spec.

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/agent/http: shared REST auth/rate-limit gate', () => {
  const src = () => readSrc('lib/agent/http.ts')

  it('checks per-IP rate limit before resolving any Bearer key', () => {
    const s = src()
    const ipLimitIdx = s.indexOf("rateLimitShared(`agent-ip:${ip}`")
    const bearerCheckIdx = s.indexOf('if (!bearerKey)')
    expect(ipLimitIdx).toBeGreaterThan(-1)
    expect(ipLimitIdx).toBeLessThan(bearerCheckIdx)
  })

  it('validates key format via isValidApiKeyFormat before hitting the DB, same as the MCP route', () => {
    const s = src()
    const formatCheckIdx = s.indexOf('isValidApiKeyFormat(bearerKey)')
    const resolveIdx = s.indexOf('resolveApiKey(bearerKey)')
    expect(formatCheckIdx).toBeGreaterThan(-1)
    expect(formatCheckIdx).toBeLessThan(resolveIdx)
  })

  it('returns the same generic "Invalid or revoked API key" message for both a malformed and an unknown key — no validity oracle', () => {
    const s = src()
    const matches = [...s.matchAll(/'Invalid or revoked API key'/g)]
    expect(matches.length).toBe(2)
  })

  it('uses agent-/agent-ip- rate-limit bucket prefixes distinct from the MCP route\'s mcp-/mcp-ip- prefixes, so the two surfaces have independent quotas', () => {
    const s = src()
    expect(s).toContain('rateLimitShared(`agent-ip:${ip}`')
    expect(s).toContain('rateLimitShared(`agent:${orgId}`')
    // The actual rateLimit() calls must use the agent- prefix, not mcp- —
    // checked against the call sites specifically rather than the whole
    // file, since the file's own comments legitimately mention the MCP
    // route's bucket names by way of contrast.
    expect(s).not.toContain('rateLimitShared(`mcp-ip:${ip}`')
    expect(s).not.toContain('rateLimitShared(`mcp:${orgId}`')
  })

  it('readAgentJsonBody caps body size using the shared readBodyCapped helper, same DoS guard as the MCP route', () => {
    const s = src()
    expect(s).toContain("import { readBodyCapped } from '@/lib/http/read-body-capped'")
    expect(s).toContain('await readBodyCapped(req, MAX_BODY_BYTES)')
    expect(s).toContain('413')
  })

  it('readAgentJsonBody rejects non-object JSON (null, arrays, primitives)', () => {
    const s = src()
    const fnStart = s.indexOf('export async function readAgentJsonBody')
    const fnBody = s.slice(fnStart)
    expect(fnBody).toContain("typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)")
  })

  it('readAgentJsonBody returns a discriminated { ok } union, not a Record/error-shape union — the latter silently breaks TS narrowing on route handlers', () => {
    const s = src()
    expect(s).toContain('{ ok: true; body: Record<string, unknown> }')
    expect(s).toContain('{ ok: false; response: NextResponse<AgentErrorBody> }')
  })

  it('looks up the org\'s plan-tiered rate limit via orgRateLimitPerMinute and threads it into rateLimitShared, rather than a hardcoded ceiling', () => {
    const s = src()
    expect(s).toContain("import { orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'")

    const callIdx = s.indexOf('orgRateLimitPerMinute(orgId)')
    const limitIdx = s.indexOf('rateLimitShared(`agent:${orgId}`')
    expect(callIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeLessThan(limitIdx)

    // The variable assigned from orgRateLimitPerMinute must be the exact
    // second argument passed to rateLimitShared for the agent: bucket — not
    // a hardcoded number reintroduced in its place.
    const callLine = s.slice(limitIdx, limitIdx + 120)
    expect(callLine).toMatch(/rateLimitShared\(`agent:\$\{orgId\}`,\s*orgRateLimitMax,\s*RATE_LIMIT_WINDOW_MS\)/)
    expect(callLine).not.toMatch(/rateLimitShared\(`agent:\$\{orgId\}`,\s*\d+/)

    // The IP-level limit (checked pre-auth, before an org is known) is
    // legitimately a fixed constant — only the per-org bucket must be
    // plan-scaled, so this asserts the hardcoded pattern still exists there
    // as the known-good contrast case.
    expect(s).toContain('rateLimitShared(`agent-ip:${ip}`, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW_MS)')
  })
})

describe('app/api/agent/kb/search/route: GET', () => {
  const src = () => readSrc('app/api/agent/kb/search/route.ts')

  it('authenticates before calling searchKbCore', () => {
    const s = src()
    const authIdx = s.indexOf('authenticateAgentRequest(req')
    const coreIdx = s.indexOf('searchKbCore(')
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(coreIdx)
  })

  it('reads query/limit from URL search params, not a request body (this is a GET)', () => {
    const s = src()
    expect(s).toContain("searchParams.get('query')")
    expect(s).toContain("searchParams.get('limit')")
  })

  it('maps a core validation error to a 400, not a 500', () => {
    const s = src()
    expect(s).toContain('agentError(400, result.error)')
  })
})

describe('app/api/agent/faq/route: GET', () => {
  const src = () => readSrc('app/api/agent/faq/route.ts')

  it('authenticates before calling getFaqCore', () => {
    const s = src()
    const authIdx = s.indexOf('authenticateAgentRequest(req')
    const coreIdx = s.indexOf('getFaqCore(')
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(coreIdx)
  })
})

describe('app/api/agent/tickets/route: GET list + POST create', () => {
  const src = () => readSrc('app/api/agent/tickets/route.ts')

  it('GET reads status/priority/category/limit/cursor from query params and maps validation errors to 400', () => {
    const s = src()
    const getStart = s.indexOf('export async function GET')
    const getBody = s.slice(getStart, s.indexOf('export async function POST'))
    expect(getBody).toContain("searchParams.get('status')")
    expect(getBody).toContain("searchParams.get('priority')")
    expect(getBody).toContain("searchParams.get('category')")
    expect(getBody).toContain("searchParams.get('cursor')")
    expect(getBody).toContain('agentError(400, result.error)')
  })

  it("POST wires idPrefix: 'agent' (distinct from MCP's 'mcp') so idempotencyKey reuse across both surfaces can never collide on the same messageId", () => {
    const s = src()
    const postStart = s.indexOf('export async function POST')
    const postBody = s.slice(postStart)
    expect(postBody).toContain("idPrefix: 'agent'")
    expect(postBody).toContain("defaultAuthorName: 'Agent API'")
  })

  it('POST reads the body via readAgentJsonBody (capped) before calling createTicketCore, and returns 201 on success', () => {
    const s = src()
    const postStart = s.indexOf('export async function POST')
    const postBody = s.slice(postStart)
    const bodyReadIdx = postBody.indexOf('readAgentJsonBody(req)')
    const coreIdx = postBody.indexOf('createTicketCore(')
    expect(bodyReadIdx).toBeGreaterThan(-1)
    expect(bodyReadIdx).toBeLessThan(coreIdx)
    expect(postBody).toContain('{ status: 201 }')
  })
})

describe('app/api/agent/answers/route: POST', () => {
  const src = () => readSrc('app/api/agent/answers/route.ts')

  it('authenticates and reads a capped JSON body before calling generateAnswerCore', () => {
    const s = src()
    const authIdx = s.indexOf('authenticateAgentRequest(req')
    const bodyIdx = s.indexOf('readAgentJsonBody(req)')
    const coreIdx = s.indexOf('generateAnswerCore(')
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(bodyIdx)
    expect(bodyIdx).toBeLessThan(coreIdx)
  })

  it('maps the deflection-limit-reached error to 429, distinct from a plain 400 validation error', () => {
    const s = src()
    expect(s).toContain("result.error.startsWith('Monthly deflection limit reached')")
    expect(s).toContain('429')
    expect(s).toContain('400')
  })
})

describe('app/api/agent/openapi.json/route: GET', () => {
  const src = () => readSrc('lib/agent/openapi-spec.ts')

  it('declares bearerAuth as the (only) security scheme, matching every route\'s actual auth requirement', () => {
    const s = src()
    expect(s).toContain("security: [{ bearerAuth: [] }]")
    expect(s).toContain("scheme: 'bearer'")
  })

  it('documents exactly the 4 real REST paths this PR ships — not aspirational ones', () => {
    const s = src()
    for (const p of ['/api/agent/kb/search', '/api/agent/faq', '/api/agent/tickets', '/api/agent/answers']) {
      expect(s, p).toContain(`'${p}'`)
    }
  })

  it('is a real OpenAPI document — parses as valid JSON with the expected top-level shape', async () => {
    const mod = await import('../../app/api/agent/openapi.json/route')
    const res = await mod.GET()
    const body = await res.json()
    expect(body.openapi).toBe('3.1.0')
    expect(Object.keys(body.paths).sort()).toEqual(
      ['/api/agent/answers', '/api/agent/faq', '/api/agent/kb/search', '/api/agent/tickets'].sort()
    )
  })
})

describe('lib/mcp/tools + app/api/agent routes: both surfaces share lib/agent/core, not duplicated logic', () => {
  it('no route file re-implements clampLimit/parseEnumArg — both surfaces import them from lib/agent/core', () => {
    const routeFiles = [
      'app/api/agent/kb/search/route.ts',
      'app/api/agent/tickets/route.ts',
      'app/api/agent/answers/route.ts',
      'lib/mcp/tools.ts',
    ]
    for (const f of routeFiles) {
      const s = readSrc(f)
      expect(s, f).not.toContain('function clampLimit')
      expect(s, f).not.toContain('function parseEnumArg')
    }
  })
})

describe('auth.ts: /api/agent is a public path (self-authenticates via Bearer key, same as /api/mcp)', () => {
  it('lists /api/agent in PUBLIC_PATHS so the session middleware does not redirect/401 it before the route runs', () => {
    const s = readSrc('auth.ts')
    const match = s.match(/const PUBLIC_PATHS = \[([^\]]+)\]/)
    expect(match).toBeTruthy()
    expect(match![1]).toContain("'/api/agent'")
  })
})

describe('public/.well-known/ai-plugin.json: points at the real Agent API spec now that it exists', () => {
  it('api.url points to /api/agent/openapi.json, not the old GEO-era health-only placeholder', () => {
    const raw = readSrc('public/.well-known/ai-plugin.json')
    const manifest = JSON.parse(raw)
    expect(manifest.api.url).toBe('https://answerloops.com/api/agent/openapi.json')
  })
})

describe('OpenAPI spec is served at the root /openapi.json too, byte-identical to /api/agent/openapi.json', () => {
  it('both route handlers render buildAgentOpenApiSpec() with no divergence', async () => {
    const rootMod = await import('../../app/openapi.json/route')
    const agentMod = await import('../../app/api/agent/openapi.json/route')
    const rootBody = await (await rootMod.GET()).json()
    const agentBody = await (await agentMod.GET()).json()
    expect(rootBody).toEqual(agentBody)
  })

  it('/openapi.json is a public path — no session redirect before the handler runs', () => {
    const s = readSrc('auth.ts')
    const match = s.match(/const PUBLIC_PATHS = \[([^\]]+)\]/)
    expect(match![1]).toContain("'/openapi.json'")
    expect(match![1]).toContain("'/.well-known'")
  })
})

describe('content/docs/reference/api/openapi.json stays in sync with the live spec', () => {
  it('the checked-in reference copy is exactly what the route renders (run `pnpm docs:generate-api` after editing the spec)', async () => {
    const mod = await import('../../app/api/agent/openapi.json/route')
    const live = await (await mod.GET()).json()
    const committed = JSON.parse(readSrc('content/docs/reference/api/openapi.json'))
    expect(committed).toEqual(live)
  })
})

describe('OpenAPI version allows scoped security requirements', () => {
  it('declares 3.1.0 — 3.0.x forbids a non-empty scope array on a plain bearer scheme', async () => {
    const mod = await import('../../app/api/agent/openapi.json/route')
    const spec = await (await mod.GET()).json()
    expect(spec.openapi).toBe('3.1.0')
  })

  it('advertises the request origin in servers so a self-hosted instance describes itself', async () => {
    const mod = await import('../../app/openapi.json/route')
    const spec = await (await mod.GET(new Request('https://self-hosted.example/openapi.json'))).json()
    expect(spec.servers).toEqual([{ url: 'https://self-hosted.example' }])
  })
})

describe('least-privilege scopes: every agent operation declares the one scope it needs', () => {
  it('each REST route passes its required scope to authenticateAgentRequest', () => {
    expect(readSrc('app/api/agent/kb/search/route.ts')).toContain("authenticateAgentRequest(req, 'kb:read')")
    expect(readSrc('app/api/agent/faq/route.ts')).toContain("authenticateAgentRequest(req, 'faq:read')")
    expect(readSrc('app/api/agent/answers/route.ts')).toContain("authenticateAgentRequest(req, 'answers:write')")
    const tickets = readSrc('app/api/agent/tickets/route.ts')
    expect(tickets).toContain("authenticateAgentRequest(req, 'tickets:read')")
    expect(tickets).toContain("authenticateAgentRequest(req, 'tickets:write')")
  })

  it('the OpenAPI spec pins each operation to its scope and publishes the scope catalogue', async () => {
    const mod = await import('../../app/api/agent/openapi.json/route')
    const spec = await (await mod.GET()).json()
    expect(spec.paths['/api/agent/kb/search'].get.security).toEqual([{ bearerAuth: ['kb:read'] }])
    expect(spec.paths['/api/agent/tickets'].post.security).toEqual([{ bearerAuth: ['tickets:write'] }])
    expect(Object.keys(spec['x-api-scopes']).sort()).toEqual(
      ['answers:write', 'faq:read', 'kb:read', 'tickets:read', 'tickets:write'].sort()
    )
  })

  it('RFC 9728 protected-resource metadata lists exactly the scope catalogue', async () => {
    const mod = await import('../../app/.well-known/oauth-protected-resource/route')
    const meta = await (await mod.GET(new Request('https://answerloops.com/.well-known/oauth-protected-resource'))).json()
    expect(meta.resource).toBe('https://answerloops.com')
    expect(meta.resource_documentation).toBe('https://answerloops.com/docs/integrations/agent-api')
    expect(meta.scopes_supported.sort()).toEqual(
      ['answers:write', 'faq:read', 'kb:read', 'tickets:read', 'tickets:write'].sort()
    )
    expect(meta.bearer_methods_supported).toEqual(['header'])
  })

  it('the MCP route enforces the per-tool scope before running the tool', () => {
    const s = readSrc('app/api/mcp/route.ts')
    const scopeIdx = s.indexOf('TOOL_SCOPES[toolName')
    const callIdx = s.indexOf('callMcpTool(toolName')
    expect(scopeIdx).toBeGreaterThan(-1)
    expect(scopeIdx).toBeLessThan(callIdx)
    expect(s).toContain('JsonRpcErrorCode.FORBIDDEN')
  })

  it('each MCP tool definition carries its required scope in _meta', () => {
    const s = readSrc('lib/mcp/tools.ts')
    for (const tool of ['search_kb', 'get_faq', 'get_tickets', 'create_ticket', 'generate_answer']) {
      expect(s, tool).toContain(`_meta: { requiredScope: TOOL_SCOPES.${tool} }`)
    }
  })
})
