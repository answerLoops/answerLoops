import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { generateApiKey, hashApiKey, isValidApiKeyFormat } from '../../lib/mcp/keys'
import { rpcError, rpcResult, JsonRpcErrorCode } from '../../lib/mcp/protocol'
import { MCP_TOOLS, callMcpTool } from '../../lib/mcp/tools'

// Tests for the MCP server: agent-facing JSON-RPC API surface (org-scoped
// Bearer API keys + tools/list + tools/call). Real unit tests for the pure
// crypto/protocol helpers; structural/source assertions for the DB-heavy
// query layer and route, matching the convention in email-v2-infra.test.ts.

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/mcp/keys: API key generation and hashing', () => {
  it('generates keys with the al_live_ prefix and 64 hex chars of entropy', () => {
    const { key, prefix } = generateApiKey()
    expect(key).toMatch(/^al_live_[0-9a-f]{64}$/)
    expect(prefix).toBe(key.slice(0, 16))
  })

  it('never returns the plaintext key twice — each call mints a fresh secret', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.key).not.toBe(b.key)
    expect(a.hash).not.toBe(b.hash)
  })

  it('hash is deterministic SHA-256 and does not leak the plaintext', () => {
    const { key, hash } = generateApiKey()
    expect(hashApiKey(key)).toBe(hash)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(key.slice(8))
  })

  it('isValidApiKeyFormat accepts a well-formed key and rejects malformed ones', () => {
    const { key } = generateApiKey()
    expect(isValidApiKeyFormat(key)).toBe(true)
    expect(isValidApiKeyFormat('al_live_tooshort')).toBe(false)
    expect(isValidApiKeyFormat('sk_live_' + 'a'.repeat(64))).toBe(false)
    expect(isValidApiKeyFormat('')).toBe(false)
  })
})

describe('lib/mcp/protocol: JSON-RPC envelope helpers', () => {
  it('rpcResult wraps a payload in a jsonrpc 2.0 success envelope', () => {
    expect(rpcResult(1, { ok: true })).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })

  it('rpcError wraps a code/message in a jsonrpc 2.0 error envelope', () => {
    expect(rpcError(1, JsonRpcErrorCode.UNAUTHORIZED, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'nope', data: undefined },
    })
  })

  it('defines distinct standard JSON-RPC error codes plus an MCP-specific UNAUTHORIZED code', () => {
    const codes = Object.values(JsonRpcErrorCode)
    expect(new Set(codes).size).toBe(codes.length)
    expect(JsonRpcErrorCode.UNAUTHORIZED).toBe(-32001)
    expect(JsonRpcErrorCode.METHOD_NOT_FOUND).toBe(-32601)
  })
})

describe('lib/mcp/tools: tool registry', () => {
  it('registers exactly the 5 roadmap tools with name/description/inputSchema', () => {
    const names = MCP_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual(['create_ticket', 'generate_answer', 'get_faq', 'get_tickets', 'search_kb'])
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(10)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('search_kb and create_ticket and generate_answer mark their primary field required', () => {
    const byName = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t]))
    expect(byName.search_kb.inputSchema.required).toContain('query')
    expect(byName.create_ticket.inputSchema.required).toContain('content')
    expect(byName.generate_answer.inputSchema.required).toContain('question')
  })

  it('callMcpTool returns an isError result for an unknown tool name instead of throwing', async () => {
    const result = await callMcpTool('not_a_real_tool', {}, 1)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown tool')
  })

  it('search_kb rejects a missing/empty query without hitting the DB', async () => {
    const result = await callMcpTool('search_kb', {}, 1)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('query is required')
  })

  it('search_kb rejects a query over 2000 chars without hitting the embedding API (cost-abuse guard)', async () => {
    const result = await callMcpTool('search_kb', { query: 'x'.repeat(2001) }, 1)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('2000 characters')
  })

  it('create_ticket rejects missing content and content over 4000 chars without hitting the DB', async () => {
    const empty = await callMcpTool('create_ticket', {}, 1)
    expect(empty.isError).toBe(true)
    expect(empty.content[0].text).toContain('content is required')

    const tooLong = await callMcpTool('create_ticket', { content: 'x'.repeat(4001) }, 1)
    expect(tooLong.isError).toBe(true)
    expect(tooLong.content[0].text).toContain('4000 characters')
  })

  it('generate_answer rejects a missing question without hitting the DB', async () => {
    const result = await callMcpTool('generate_answer', {}, 1)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('question is required')
  })

  it('generate_answer rejects a question over 2000 chars without hitting the LLM (cost-abuse guard)', async () => {
    const result = await callMcpTool('generate_answer', { question: 'x'.repeat(2001) }, 1)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('2000 characters')
  })
})

describe('lib/mcp/tools: thin wrapper over lib/agent/core, preserving mcp-specific identity', () => {
  const src = () => readSrc('lib/mcp/tools.ts')

  it('every tool delegates to the shared core module rather than re-implementing pipeline logic', () => {
    const s = src()
    for (const coreFn of ['searchKbCore', 'getFaqCore', 'getTicketsCore', 'createTicketCore', 'generateAnswerCore']) {
      expect(s, coreFn).toContain(coreFn)
    }
    // The old inline implementations (embedText, processCommunityMessage,
    // checkDeflectionLimit calls) must not be duplicated here anymore — a
    // duplicate copy is exactly the drift risk core.ts was extracted to avoid.
    expect(s).not.toContain('processCommunityMessage(')
    expect(s).not.toContain('checkDeflectionLimit(orgId)')
  })

  it("create_ticket wires idPrefix: 'mcp' — changing this would silently break existing clients' idempotencyKey-derived retries", () => {
    const s = src()
    const fnStart = s.indexOf('async function createTicketTool')
    const fnBody = s.slice(fnStart, fnStart + 500)
    expect(fnBody).toContain("idPrefix: 'mcp'")
    expect(fnBody).toContain("defaultAuthorName: 'MCP agent'")
  })

  it('callMcpTool catches thrown errors from any tool instead of letting them 500 the route', () => {
    const s = src()
    const dispatchStart = s.indexOf('export async function callMcpTool')
    const dispatchBody = s.slice(dispatchStart)
    expect(dispatchBody).toContain('try {')
    expect(dispatchBody).toContain('catch (err)')
    expect(dispatchBody).toContain("errorResult('Internal error running tool')")
  })

  it('callMcpTool returns an isError result for an unknown tool name instead of throwing', async () => {
    const result = await callMcpTool('not_a_real_tool', {}, 1)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown tool')
  })
})

describe('lib/agent/core: shared business logic behind both the MCP server and the REST Agent API', () => {
  const src = () => readSrc('lib/agent/core.ts')

  it('createTicketCore routes through the same AI triage pipeline as every other channel, tagged as platform mcp', () => {
    const s = src()
    expect(s).toContain('processCommunityMessage(')
    expect(s).toContain("platform: 'mcp'")
  })

  it('generateAnswerCore claims its usage slot before running any LLM call', () => {
    const s = src()
    const gateIdx = s.indexOf('reserveGeneration(orgId, keyId)')
    const embedIdx = s.indexOf('embedText(question, orgId)')
    const generateIdx = s.indexOf('answerAgent.generate(')
    expect(gateIdx).toBeGreaterThan(-1)
    // Both the check and the usage write happen before any spend. Gating on a
    // read and recording afterwards let concurrent callers all pass a ceiling
    // they had collectively already reached.
    expect(embedIdx).toBeGreaterThan(gateIdx)
    expect(generateIdx).toBeGreaterThan(gateIdx)
  })

  it('caps all list-returning functions at MAX_RESULTS to avoid a full-dataset exfil in one call', () => {
    const s = src()
    expect(s).toContain('export const MAX_RESULTS = 20')
    expect(s).toContain('clampLimit(args.limit, 5)')
    expect(s).toContain('clampLimit(args.limit, 10)')
    const clampStart = s.indexOf('export function clampLimit')
    const clampBody = s.slice(clampStart, clampStart + 300)
    expect(clampBody).toContain('Math.min(n, MAX_RESULTS)')
    expect(clampBody).toContain('n < 1')
  })

  it('getTicketsCore passes limit down to the query layer instead of pulling the full org table into memory', () => {
    const s = src()
    const fnStart = s.indexOf('export async function getTicketsCore')
    const fnBody = s.slice(fnStart, fnStart + 1400)
    // Fetches limit + 1 (one row past the page) so it can tell whether
    // another page follows without a second round trip — still a DB-level
    // limit, not an unbounded fetch of the org's tickets.
    expect(fnBody).toMatch(/getTickets\(\s*\{[\s\S]*?\},\s*orgId,\s*limit \+ 1,\s*cursor\s*\)/)
  })

  it('getTicketsCore validates enum filters instead of casting caller input straight into the query', () => {
    const s = src()
    const fnStart = s.indexOf('export async function getTicketsCore')
    const fnBody = s.slice(fnStart, fnStart + 1400)
    expect(fnBody).toContain('parseEnumArg<TicketStatus>(args.status, TICKET_STATUSES)')
    expect(fnBody).toContain('parseEnumArg<Priority>(args.priority, PRIORITIES)')
    expect(fnBody).toContain('parseEnumArg<TicketCategory>(args.category, CATEGORIES)')
    // Invalid values are rejected with an error, not silently filtered on.
    expect(fnBody).toContain('status === null')
    expect(fnBody).not.toContain('args.status as TicketStatus')
  })

  it("createTicketCore's messageId prefix is caller-supplied (opts.idPrefix), not hardcoded — so the MCP and REST surfaces can share this logic without colliding or drifting from each other's existing behavior", () => {
    const s = src()
    const fnStart = s.indexOf('export async function createTicketCore')
    const fnBody = s.slice(fnStart, fnStart + 1500)
    expect(fnBody).toContain('const idempotencyKey =')
    expect(fnBody).toMatch(/`\$\{opts\.idPrefix\}-\$\{orgId\}-\$\{idempotencyKey\}`/)
    // Without a key it must still fall back to the old random-id behavior —
    // idempotency is opt-in, not a breaking change for existing callers.
    expect(fnBody).toContain('Math.random().toString(36)')
    expect(fnBody).not.toMatch(/`mcp-/)
    expect(fnBody).not.toMatch(/`agent-/)
  })

  it('generateAnswerCore bills the reserved row once confidence is known', () => {
    const s = src()
    const fnStart = s.indexOf('export async function generateAnswerCore')
    const fnBody = s.slice(fnStart)
    const reserveIdx = fnBody.indexOf('reserveGeneration(orgId, keyId)')
    const highConfidenceIdx = fnBody.indexOf('shouldAutoDeflect(assessment)')
    const commitIdx = fnBody.indexOf('commitDeflection(orgId, reservation.generationId)')
    expect(reserveIdx).toBeGreaterThan(-1)
    expect(highConfidenceIdx).toBeGreaterThan(reserveIdx)
    // Promotion has to come after the confidence grade — only confident
    // answers bill — and the row it promotes is the one reserved up front.
    expect(commitIdx).toBeGreaterThan(highConfidenceIdx)
  })

  it('generateAnswerCore only bills when the answer cleared the confidence bar', () => {
    const s = src()
    const fnStart = s.indexOf('export async function generateAnswerCore')
    const fnBody = s.slice(fnStart)
    const guardIdx = fnBody.indexOf('if (highConfidence) {')
    const commitIdx = fnBody.indexOf('commitDeflection(orgId, reservation.generationId)')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeGreaterThan(guardIdx)
  })
})

describe('lib/db/queries/api-generations: generate_answer usage tracking', () => {
  it('exports the reserve/promote pair and getMonthlyApiGenerations', async () => {
    const q = await import('../../lib/db/queries/api-generations')
    expect(typeof q.reserveApiGeneration).toBe('function')
    expect(typeof q.markApiGenerationBilled).toBe('function')
    expect(typeof q.getMonthlyApiGenerations).toBe('function')
  })

  it('getMonthlyApiGenerations only counts high-confidence rows, mirroring auto_deflected semantics', () => {
    const src = readSrc('lib/db/queries/api-generations.ts')
    expect(src).toContain('eq(apiGenerations.highConfidence, 1)')
  })
})

describe('lib/billing/usage: getMonthlyDeflections folds in API-originated generations', () => {
  it('adds getMonthlyApiGenerations to the ticket-based deflection count instead of only counting tickets', () => {
    const src = readSrc('lib/billing/usage.ts')
    expect(src).toContain('getMonthlyApiGenerations(orgId, periodStart)')
    const fnStart = src.indexOf('export async function getMonthlyDeflections')
    const fnBody = src.slice(fnStart, fnStart + 900)
    expect(fnBody).toMatch(/Number\(row\?\.n \?\? 0\) \+ apiGenerations/)
  })
})

describe('lib/db/queries/api-keys: org-scoped key lifecycle', () => {
  const src = () => readSrc('lib/db/queries/api-keys.ts')

  it('exports the full key lifecycle: create, list, revoke, resolve', async () => {
    const q = await import('../../lib/db/queries/api-keys')
    for (const fn of ['createApiKey', 'listApiKeys', 'revokeApiKey', 'resolveApiKey']) {
      expect(typeof (q as Record<string, unknown>)[fn], fn).toBe('function')
    }
  })

  it('createApiKey never persists the plaintext, only the hash', () => {
    const s = src()
    const fnStart = s.indexOf('export async function createApiKey')
    const fnBody = s.slice(fnStart, fnStart + 1400)
    expect(fnBody).toContain('keyHash: hash')
    expect(fnBody).not.toMatch(/keyHash:\s*key[,\s]/)
  })

  it('createApiKey enforces the per-org active-key cap before minting a new credential', () => {
    const s = src()
    expect(s).toContain('MAX_ACTIVE_KEYS_PER_ORG')
    const fnStart = s.indexOf('export async function createApiKey')
    const fnBody = s.slice(fnStart, fnStart + 1400)
    // The count is org-scoped and excludes revoked keys, and the check runs
    // before generateApiKey ever produces a plaintext.
    expect(fnBody).toContain('isNull(apiKeys.revokedAt)')
    const capCheckIdx = fnBody.indexOf('MAX_ACTIVE_KEYS_PER_ORG')
    const generateIdx = fnBody.indexOf('generateApiKey()')
    expect(capCheckIdx).toBeGreaterThan(-1)
    expect(generateIdx).toBeGreaterThan(capCheckIdx)
  })

  it('revokeApiKey scopes the update by orgId in addition to keyId (IDOR guard)', () => {
    const s = src()
    const fnStart = s.indexOf('export async function revokeApiKey')
    const fnBody = s.slice(fnStart, fnStart + 400)
    expect(fnBody).toContain('and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId))')
  })

  it('listApiKeys excludes revoked records from the workspace credential list', () => {
    const s = src()
    const fnStart = s.indexOf('export async function listApiKeys')
    const fnBody = s.slice(fnStart, fnStart + 500)
    expect(fnBody).toContain('and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt))')
  })

  it('resolveApiKey rejects revoked keys (isNull filter) and expired keys (explicit date check)', () => {
    const s = src()
    const fnStart = s.indexOf('export async function resolveApiKey')
    const fnBody = s.slice(fnStart, fnStart + 800)
    expect(fnBody).toContain('isNull(apiKeys.revokedAt)')
    expect(fnBody).toMatch(/if \(row\.expiresAt && row\.expiresAt < new Date\(\)\.toISOString\(\)\) return null/)
  })

  it('resolveApiKey looks up by hash, never by plaintext key', () => {
    const s = src()
    const fnStart = s.indexOf('export async function resolveApiKey')
    const fnBody = s.slice(fnStart, fnStart + 400)
    expect(fnBody).toContain('hashApiKey(plaintextKey)')
    expect(fnBody).toContain('eq(apiKeys.keyHash, hash)')
  })

  it('resolveApiKey records last-used on every successful resolution', () => {
    const s = src()
    const fnStart = s.indexOf('export async function resolveApiKey')
    const fnBody = s.slice(fnStart, fnStart + 800)
    expect(fnBody).toContain('lastUsedAt: new Date().toISOString()')
  })

  it('createApiKey accepts an optional expiresInDays and writes a computed expiresAt', () => {
    const s = src()
    const fnStart = s.indexOf('export async function createApiKey')
    const fnBody = s.slice(fnStart, fnStart + 700)
    expect(fnBody).toContain('expiresInDays?: number | null')
    expect(fnBody).toMatch(/expiresInDays\s*\?\s*new Date\(Date\.now\(\)/)
    expect(fnBody).toContain('expiresAt')
  })
})

describe('schema: api_keys table', () => {
  it('defines the api_keys table with hash/prefix/revocation/expiry columns', async () => {
    const { apiKeys } = await import('../../lib/db/schema')
    const cols = apiKeys as unknown as Record<string, unknown>
    for (const col of ['orgId', 'keyHash', 'keyPrefix', 'name', 'lastUsedAt', 'expiresAt', 'revokedAt']) {
      expect(cols, col).toHaveProperty(col)
    }
  })

  it('migration file creates api_keys with a unique key_hash and an org index', () => {
    const sql = readSrc('drizzle/0015_api_keys.sql')
    expect(sql).toMatch(/key_hash TEXT NOT NULL UNIQUE/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys \(org_id\)/)
    expect(sql).toMatch(/REFERENCES orgs\(id\)/)
  })
})

describe('schema: api_generations table (generate_answer usage metering)', () => {
  it('defines the api_generations table with an org-scoped high_confidence flag', async () => {
    const { apiGenerations } = await import('../../lib/db/schema')
    const cols = apiGenerations as unknown as Record<string, unknown>
    for (const col of ['orgId', 'highConfidence', 'createdAt']) {
      expect(cols, col).toHaveProperty(col)
    }
  })

  it('migration file creates api_generations with an org index', () => {
    const sql = readSrc('drizzle/0016_api_generations.sql')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS api_generations/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_api_generations_org ON api_generations \(org_id\)/)
    expect(sql).toMatch(/REFERENCES orgs\(id\)/)
  })
})

describe('lib/db/queries/tickets: getTickets supports a DB-level limit', () => {
  it('accepts an optional limit param and applies it with $dynamic().limit(), not a client-side slice', () => {
    const src = readSrc('lib/db/queries/tickets.ts')
    const fnStart = src.indexOf('export async function getTickets')
    const fnBody = src.slice(fnStart, fnStart + 1400)
    expect(fnBody).toContain('limit?: number')
    expect(fnBody).toContain('.$dynamic()')
    expect(fnBody).toMatch(/if \(limit\) query = query\.limit\(limit\)/)
  })
})

describe('app/api/mcp/route: JSON-RPC dispatcher', () => {
  const src = () => readSrc('app/api/mcp/route.ts')

  it('allows initialize and notifications/initialized without auth, gates everything else on a Bearer key', () => {
    const s = src()
    const initIdx = s.indexOf("body.method === 'initialize'")
    const notifIdx = s.indexOf("body.method === 'notifications/initialized'")
    const authIdx = s.indexOf('if (!bearerKey)')
    expect(initIdx).toBeGreaterThan(-1)
    expect(notifIdx).toBeGreaterThan(initIdx)
    expect(authIdx).toBeGreaterThan(notifIdx)
  })

  it('resolves the Bearer key via resolveApiKey and 401s on an invalid/revoked key', () => {
    const s = src()
    expect(s).toContain('resolveApiKey(bearerKey)')
    expect(s).toContain("JsonRpcErrorCode.UNAUTHORIZED, 'Invalid or revoked API key'")
  })

  it('caps the request body size while streaming — pre-auth memory-DoS guard', () => {
    const s = src()
    expect(s).toContain('MAX_BODY_BYTES')
    expect(s).toContain("import { readBodyCapped } from '@/lib/http/read-body-capped'")
    // Header check runs first as a fast reject, then the body is read through
    // readBodyCapped, which counts actual bytes as chunks arrive and aborts
    // the read the moment the cap is crossed — req.text() would buffer the
    // whole body before any check could run, and content-length can lie or be
    // absent on chunked transfer.
    const headerCheckIdx = s.indexOf("req.headers.get('content-length')")
    const cappedReadIdx = s.indexOf('await readBodyCapped(req, MAX_BODY_BYTES)')
    expect(headerCheckIdx).toBeGreaterThan(-1)
    expect(cappedReadIdx).toBeGreaterThan(headerCheckIdx)
    expect(s).not.toContain('await req.text()')
    const helperSrc = readSrc('lib/http/read-body-capped.ts')
    expect(helperSrc).toContain('total += value.byteLength')
    expect(helperSrc).toContain('reader.cancel()')
    expect(s).toContain('{ status: 413 }')
  })

  it('rejects JSON that is not a JSON-RPC object (null, arrays, primitives) instead of throwing', () => {
    const s = src()
    expect(s).toContain("typeof body !== 'object' || body === null || Array.isArray(body)")
  })

  it('rejects malformed keys via isValidApiKeyFormat before hashing or hitting the DB', () => {
    const s = src()
    const formatCheckIdx = s.indexOf('isValidApiKeyFormat(bearerKey)')
    const resolveIdx = s.indexOf('resolveApiKey(bearerKey)')
    expect(formatCheckIdx).toBeGreaterThan(-1)
    expect(formatCheckIdx).toBeLessThan(resolveIdx)
    // Must return the same message as an unknown key — no validity oracle.
    const formatBranch = s.slice(formatCheckIdx, formatCheckIdx + 250)
    expect(formatBranch).toContain('Invalid or revoked API key')
  })

  it('applies a per-org rate limit before dispatching tools/list or tools/call', () => {
    const s = src()
    const limitIdx = s.indexOf('rateLimitShared(`mcp:${orgId}`')
    const toolsListIdx = s.indexOf("body.method === 'tools/list'")
    expect(limitIdx).toBeGreaterThan(-1)
    expect(limitIdx).toBeLessThan(toolsListIdx)
  })

  it('looks up the org\'s plan-tiered rate limit via orgRateLimitPerMinute and threads it into rateLimitShared, rather than a hardcoded ceiling', () => {
    const s = src()
    expect(s).toContain("import { orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'")

    const callIdx = s.indexOf('orgRateLimitPerMinute(orgId)')
    const limitIdx = s.indexOf('rateLimitShared(`mcp:${orgId}`')
    expect(callIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeLessThan(limitIdx)

    // The variable assigned from orgRateLimitPerMinute must be the exact
    // second argument passed to rateLimitShared for the mcp: bucket — not a
    // hardcoded number reintroduced in its place.
    const callLine = s.slice(limitIdx, limitIdx + 120)
    expect(callLine).toMatch(/rateLimitShared\(`mcp:\$\{orgId\}`,\s*orgRateLimitMax,\s*RATE_LIMIT_WINDOW_MS\)/)
    expect(callLine).not.toMatch(/rateLimitShared\(`mcp:\$\{orgId\}`,\s*\d+/)

    // The IP-level limit (checked pre-auth, before an org is known) is
    // legitimately a fixed constant — only the per-org bucket must be
    // plan-scaled, so this asserts the hardcoded pattern still exists there
    // as the known-good contrast case.
    expect(s).toContain('rateLimitShared(`mcp-ip:${ip}`, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW_MS)')
  })

  it('applies a per-IP rate limit before any auth check, so unauthenticated traffic cannot hammer the route unthrottled', () => {
    const s = src()
    const ipLimitIdx = s.indexOf('rateLimitShared(`mcp-ip:${ip}`')
    const bodySizeCheckIdx = s.indexOf('contentLength > MAX_BODY_BYTES')
    const authCheckIdx = s.indexOf('if (!bearerKey)')
    expect(ipLimitIdx).toBeGreaterThan(-1)
    expect(ipLimitIdx).toBeLessThan(bodySizeCheckIdx)
    expect(ipLimitIdx).toBeLessThan(authCheckIdx)
  })

  it('rejects tools/call for a tool name not present in MCP_TOOLS before invoking it', () => {
    const s = src()
    expect(s).toContain('MCP_TOOLS.some((t) => t.name === toolName)')
    expect(s).toContain('JsonRpcErrorCode.METHOD_NOT_FOUND')
  })

  it('rejects malformed JSON and non-2.0 envelopes with the correct JSON-RPC error codes', () => {
    const s = src()
    expect(s).toContain('JsonRpcErrorCode.PARSE_ERROR')
    expect(s).toContain("body.jsonrpc !== '2.0'")
    expect(s).toContain('JsonRpcErrorCode.INVALID_REQUEST')
  })
})

describe('auth.ts: /api/mcp is a public path (self-authenticates via Bearer key)', () => {
  it('lists /api/mcp in PUBLIC_PATHS so the session middleware does not 401 it before the route runs', () => {
    const s = readSrc('auth.ts')
    const match = s.match(/const PUBLIC_PATHS = \[([^\]]+)\]/)
    expect(match).toBeTruthy()
    expect(match![1]).toContain("'/api/mcp'")
  })
})

describe('SourcePlatform / Platform: mcp is a first-class value everywhere source_platform is branched on', () => {
  it("types/index.ts SourcePlatform includes 'mcp'", () => {
    const s = readSrc('types/index.ts')
    expect(s).toMatch(/SourcePlatform\s*=[^;]*'mcp'/)
  })

  it("lib/ingest/pipeline.ts Platform type includes 'mcp'", () => {
    const s = readSrc('lib/ingest/pipeline.ts')
    expect(s).toMatch(/Platform\s*=[^;]*'mcp'/)
  })

  it('postReply no-ops for mcp tickets instead of trying to post to a nonexistent channel', () => {
    // postReply moved to lib/channels/post-reply.ts as part of the
    // Automatic Deflections toggle — shared by lib/ai/agent.ts and
    // lib/actions/tickets.ts instead of each hand-rolling its own switch.
    const s = readSrc('lib/channels/post-reply.ts')
    expect(s).toMatch(/if \(platform === 'mcp'\) return null/)
  })

  it('staff reply/draft-edit actions also skip posting for mcp tickets — source_channel_id holds a synthetic id, not a real channel', () => {
    // create_ticket stashes its synthetic messageId in source_channel_id, which
    // reads as "present" to a naive truthiness check — lib/actions/tickets.ts's
    // shared sendReply() helper (used by postReplyAction, approve, and edit
    // alike) must explicitly exclude 'mcp', not just check channelId
    // presence, or every staff reply fires a doomed live API call.
    const s = readSrc('lib/actions/tickets.ts')
    const fnIdx = s.indexOf('async function sendReply')
    const fnBody = s.slice(fnIdx, s.indexOf('\n}', fnIdx))
    expect(fnBody).toMatch(/if \(ticket\.source_platform === 'mcp'\) return null/)
  })
})
