import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// GitHub issue #222: a ticket's after()-scheduled background job
// (embedding, AI draft, notifications) has been observed to silently never
// run for some messages under rapid concurrent ingestion — the ticket gets
// created (logged), but produces zero further log output, no error, and
// stays showing "AI pending" indefinitely. Not root-caused (a next/server
// after() limitation under concurrency is suspected but unconfirmed) —
// fixed with the safety net the issue itself proposes: a periodic sweep
// that finds tickets stuck in ai_draft_status = 'pending' past a threshold
// and retries the missing background work.
//
// Three pieces, each covered below:
// 1. lib/ingest/pipeline.ts's after()-callback body extracted into a
//    standalone exported runBackgroundEnrichment(ticket, orgId, aiPurpose)
//    that derives everything it needs from the persisted ticket row, so it
//    works identically whether called immediately after ticket creation or
//    minutes later from a retry.
// 2. app/api/ingest/retry-stuck/route.ts — BOT_SECRET-authenticated route
//    that atomically claims a stuck ticket (so a race with the original
//    job finishing doesn't double-process it) and calls
//    runBackgroundEnrichment directly, awaited, no after() involved.
// 3. bot/index.ts — a periodic sweep (matching the existing
//    startOrgPurgeSweep pattern) that finds candidates and forwards each to
//    the retry route over HTTP, never importing the pipeline in-process —
//    same reasoning as the Slack poller (see
//    tests/unit/slack-poller-http-forward.test.ts): next/server's after()
//    can only be scheduled from inside a real Next.js request, so anything
//    running from the bot's plain-Node process must forward over HTTP
//    rather than call pipeline code directly.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const { claimStuckTicketForRetry, runBackgroundEnrichment, orgHasAIKey, reservePlatformKeyTrial, getDeploymentMode } = vi.hoisted(() => ({
  claimStuckTicketForRetry: vi.fn(),
  runBackgroundEnrichment: vi.fn(async () => undefined),
  orgHasAIKey: vi.fn(async () => true),
  reservePlatformKeyTrial: vi.fn(async () => false),
  getDeploymentMode: vi.fn(() => 'cloud'),
}))

vi.mock('@/lib/db/queries/tickets', () => ({ claimStuckTicketForRetry }))
vi.mock('@/lib/ingest/pipeline', () => ({ runBackgroundEnrichment }))
vi.mock('@/lib/db/queries/ai-config', () => ({ orgHasAIKey }))
vi.mock('@/lib/billing/platform-key-trial', () => ({ reservePlatformKeyTrial }))
vi.mock('@/lib/billing/plans', () => ({ getDeploymentMode }))

describe('lib/ingest/pipeline.ts — runBackgroundEnrichment is retry-safe', () => {
  const src = read('lib/ingest/pipeline.ts')

  it('is exported so the retry route can call it directly', () => {
    expect(src).toContain('export async function runBackgroundEnrichment(')
  })

  it('processCommunityMessage schedules it via after() instead of an inline closure', () => {
    expect(src).toContain('after(() => runBackgroundEnrichment(ticket, orgId, aiPurpose))')
  })

  it('derives every input from the ticket row, not from pipeline-local closure variables', () => {
    const fnIdx = src.indexOf('export async function runBackgroundEnrichment(')
    const fnBody = src.slice(fnIdx, src.indexOf('\nexport ', fnIdx + 1) === -1 ? src.length : src.indexOf('\nexport ', fnIdx + 1))
    expect(fnBody).toContain('ticket.source_author_name')
    expect(fnBody).toContain('ticket.source_platform')
    expect(fnBody).toContain('ticket.source_channel_id')
    expect(fnBody).toContain('ticket.source_thread_id')
  })
})

describe('lib/db/queries/tickets.ts — stuck-ticket discovery and atomic claim', () => {
  const src = read('lib/db/queries/tickets.ts')

  it('getStuckPendingTickets filters on ai_draft_status, open status, and a time window', () => {
    const fnIdx = src.indexOf('export async function getStuckPendingTickets(')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain("ai_draft_status = 'pending'")
    expect(fnBody).toContain("status = 'open'")
    // Not make_interval(mins => ...) — that named-argument syntax combined
    // with a bind parameter in the same position broke this query in
    // production (postgres.js mis-tokenizing it), and no test here ever
    // ran it against a real Postgres to catch that. Plain interval
    // multiplication has no equivalent ambiguity.
    expect(fnBody).toContain("interval '1 minute'")
    expect(fnBody).not.toContain('make_interval')
  })

  it('bounds the sweep to the last 24h so a permanently-failing ticket is not retried forever', () => {
    const fnIdx = src.indexOf('export async function getStuckPendingTickets(')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain("interval '24 hours'")
  })

  it('claimStuckTicketForRetry is a single atomic UPDATE...RETURNING gated on ai_draft_status still being pending', () => {
    const fnIdx = src.indexOf('export async function claimStuckTicketForRetry(')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain('.update(tickets)')
    expect(fnBody).toContain("eq(tickets.aiDraftStatus, 'pending')")
    expect(fnBody).toContain('.returning()')
  })
})

describe('app/api/ingest/retry-stuck/route.ts', () => {
  const src = read('app/api/ingest/retry-stuck/route.ts')

  it('authenticates with the platform-wide BOT_SECRET, not a per-integration secret', () => {
    expect(src).toContain('isPlatformBotRequest(request)')
    expect(src).not.toContain('getIntegrationByBotSecret')
  })

  it('claims the ticket before doing any work, and no-ops cleanly if the claim fails', () => {
    const claimIdx = src.indexOf('claimStuckTicketForRetry(ticket_id, org_id)')
    const enrichIdx = src.indexOf('runBackgroundEnrichment(')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(enrichIdx).toBeGreaterThan(claimIdx)
    expect(src).toContain('if (!ticket) return Response.json({ ok: true, claimed: false })')
  })

  it('awaits runBackgroundEnrichment directly rather than scheduling it via after()', () => {
    expect(src).toContain('await runBackgroundEnrichment(ticket, ticketOrgId, aiPurpose)')
    expect(src).not.toMatch(/from ['"]next\/server['"]/)
  })

  it('is covered by the existing /api/ingest prefix in auth.ts PUBLIC_PATHS, so no separate entry is needed', () => {
    const authSrc = read('auth.ts')
    const match = authSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)
    expect(match).not.toBeNull()
    const publicPaths = match![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    const covered = publicPaths.some((p) => '/api/ingest/retry-stuck' === p || '/api/ingest/retry-stuck'.startsWith(`${p}/`))
    expect(covered, 'retry-stuck must be covered by a PUBLIC_PATHS prefix or the session-auth middleware will 401 it before BOT_SECRET auth ever runs').toBe(true)
  })
})

describe('bot/index.ts — stuck-ticket sweep', () => {
  const src = read('bot/index.ts')

  it('does not import the pipeline in-process — forwards over HTTP like the Slack poller does', () => {
    expect(src).not.toMatch(/import\s*\{[^}]*runBackgroundEnrichment[^}]*\}/)
    expect(src).not.toContain("from '../lib/ingest/pipeline'")
  })

  it('forwards to /api/ingest/retry-stuck with the bot secret', () => {
    const fnIdx = src.indexOf('function startStuckTicketSweep(')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnBody = src.slice(fnIdx, src.indexOf('\n}\n', fnIdx))
    expect(fnBody).toContain('${targetUrl}/api/ingest/retry-stuck')
    expect(fnBody).toContain('Authorization: `Bearer ${botSecret}`')
  })

  it('is started alongside the org purge sweep at boot', () => {
    expect(src).toContain('startOrgPurgeSweep()')
    expect(src).toContain('startStuckTicketSweep()')
  })

  it("a single ticket's retry failure is caught and does not crash the sweep loop", () => {
    const fnIdx = src.indexOf('function startStuckTicketSweep(')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}\n', fnIdx))
    const forIdx = fnBody.indexOf('for (const')
    const catchIdx = fnBody.indexOf('} catch (err) {', forIdx)
    expect(forIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(forIdx)
  })
})

describe('app/api/ingest/retry-stuck — end-to-end claim/enrich behavior', () => {
  const ORIGINAL_BOT_SECRET = process.env.BOT_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BOT_SECRET = 'test-bot-secret'
  })

  afterEach(() => {
    process.env.BOT_SECRET = ORIGINAL_BOT_SECRET
  })

  it('rejects requests without the correct BOT_SECRET', async () => {
    const { POST } = await import('@/app/api/ingest/retry-stuck/route')
    const res = await POST(new Request('http://x/api/ingest/retry-stuck', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: 1, org_id: 1 }),
    }))
    expect(res.status).toBe(401)
    expect(claimStuckTicketForRetry).not.toHaveBeenCalled()
  })

  it('returns claimed:false and never calls runBackgroundEnrichment when the claim fails (already processed)', async () => {
    claimStuckTicketForRetry.mockResolvedValue(null)
    const { POST } = await import('@/app/api/ingest/retry-stuck/route')
    const res = await POST(new Request('http://x/api/ingest/retry-stuck', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-bot-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: 1, org_id: 1 }),
    }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, claimed: false })
    expect(runBackgroundEnrichment).not.toHaveBeenCalled()
  })

  it('claims successfully and runs enrichment when the ticket is genuinely still pending', async () => {
    claimStuckTicketForRetry.mockResolvedValue({ id: 1, org_ticket_number: 1 })
    const { POST } = await import('@/app/api/ingest/retry-stuck/route')
    const res = await POST(new Request('http://x/api/ingest/retry-stuck', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-bot-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: 1, org_id: 7 }),
    }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, claimed: true })
    expect(runBackgroundEnrichment).toHaveBeenCalledWith({ id: 1, org_ticket_number: 1 }, 7, 'production')
  })
})
