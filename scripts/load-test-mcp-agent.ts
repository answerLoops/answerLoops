/**
 * Load test for /api/mcp and /api/v1/agent/* — Roadmap pre-launch checklist
 * item 1 ("Load test /api/mcp and /api/agent/* before committing to tiered
 * rate limits").
 *
 * What this checks, per plan tier (standard/pro/enterprise):
 *   1. The shared Postgres rate limiter (`rateLimitShared`, lib/ratelimit.ts)
 *      never lets an org get more successful requests in a window than its
 *      plan's ceiling (`orgRateLimitPerMinute`) — no double-admits under
 *      real concurrency.
 *   2. Latency and error rate at and above that ceiling, so a breaking point
 *      in the current Neon + Railway setup (DB pool `max: 10` in
 *      lib/db/drizzle.ts, connection ceiling, instance count) shows up as
 *      data instead of a guess.
 *
 * This is the test infrastructure, not a verdict — see Roadmap item 1's
 * "Effort: not yet scoped" note. Run small first (defaults below), then ramp
 * --orgs-per-tier and --overshoot up once you've read the results.
 *
 * IMPORTANT: this creates real rows (orgs, subscriptions, api_keys) against
 * whatever DATABASE_URL you point it at and drives real load against
 * --url. Never point --url at a production deployment. Cleans up its own
 * rows when done (or on Ctrl-C) unless --keep is passed.
 *
 * Usage:
 *   tsx scripts/load-test-mcp-agent.ts [options]
 *
 * Options:
 *   --url <base>         Target app base URL (default http://localhost:3000)
 *   --orgs-per-tier <n>  Test orgs to create per plan tier (default 2)
 *   --duration <sec>     How long each worker hammers its route (default 75)
 *   --overshoot <mult>   Fire at this multiple of the org's ceiling (default 1.5)
 *   --routes <list>      Comma-separated: mcp,agent (default "mcp,agent")
 *   --keep                Skip cleanup — leave test orgs/keys/subs in place
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadDotEnvIfMissing(key: string): void {
  if (process.env[key]) return
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const k = trimmed.slice(0, eq).trim()
      let v = trimmed.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    // No .env file — fall through and let the missing var fail naturally
    // where it's actually needed (DATABASE_URL check in lib/db/drizzle.ts).
  }
}

// Must happen before any dynamic import below touches lib/db/drizzle.ts,
// which reads process.env.DATABASE_URL at first call, not at import time.
loadDotEnvIfMissing('DATABASE_URL')

type Args = {
  url: string
  orgsPerTier: number
  durationSec: number
  overshoot: number
  routes: Set<'mcp' | 'agent'>
  keep: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag)
    return i === -1 ? fallback : argv[i + 1]
  }
  return {
    url: get('--url', 'http://localhost:3000').replace(/\/$/, ''),
    orgsPerTier: Number(get('--orgs-per-tier', '2')),
    durationSec: Number(get('--duration', '75')),
    overshoot: Number(get('--overshoot', '1.5')),
    routes: new Set(get('--routes', 'mcp,agent').split(',').map((s) => s.trim()) as ('mcp' | 'agent')[]),
    keep: argv.includes('--keep'),
  }
}

interface RequestSample {
  tSec: number // seconds since this worker started
  status: number | 'error'
  latencyMs: number
}

interface WorkerResult {
  orgId: number
  planId: string
  ceiling: number
  route: 'mcp' | 'agent'
  samples: RequestSample[]
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  console.log('⚠️  This drives real concurrent load against a real DB and creates real rows.')
  console.log(`    Target: ${args.url}`)
  console.log(`    Orgs per tier: ${args.orgsPerTier} · Duration: ${args.durationSec}s · Overshoot: ${args.overshoot}x ceiling`)
  console.log('    If this app is pointed at a Neon project near its compute-time quota,')
  console.log('    this WILL burn more of it — check Neon usage before a large run.\n')

  const { getDb } = await import('@/lib/db/drizzle')
  const { orgs, apiKeys, subscriptions } = await import('@/lib/db/schema')
  const { inArray } = await import('drizzle-orm')
  const { createApiKey } = await import('@/lib/db/queries/api-keys')
  const { upsertSubscription } = await import('@/lib/db/queries/billing')
  const { ORDERED_PLANS } = await import('@/lib/billing/plans')
  const { rateLimitPerMinute } = await import('@/lib/billing/entitlements')

  const db = getDb()
  const runId = Date.now().toString(36)
  const originSecret = process.env.ORIGIN_VERIFY_SECRET?.trim()

  type TestOrg = { orgId: number; planId: string; ceiling: number; apiKey: string }
  const testOrgs: TestOrg[] = []

  console.log('Setting up test orgs (org + subscription + API key per tier)...')
  for (const plan of ORDERED_PLANS) {
    for (let i = 0; i < args.orgsPerTier; i++) {
      const [org] = await db
        .insert(orgs)
        .values({ name: `loadtest-${plan.id}-${i}-${runId}` })
        .returning({ id: orgs.id })

      await upsertSubscription({
        orgId: org.id,
        planId: plan.id,
        status: 'active',
        stripeCustomerId: `cus_loadtest_${runId}`,
        stripeSubscriptionId: `sub_loadtest_${runId}_${plan.id}_${i}`,
      })

      const { plaintextKey } = await createApiKey(org.id, `load-test-${runId}`)
      testOrgs.push({ orgId: org.id, planId: plan.id, ceiling: rateLimitPerMinute(plan.id), apiKey: plaintextKey })
    }
  }
  console.log(`Created ${testOrgs.length} test orgs.\n`)

  const results: WorkerResult[] = []
  let interrupted = false
  process.on('SIGINT', () => {
    interrupted = true
  })

  function headers(apiKey: string): Record<string, string> {
    const h: Record<string, string> = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
    if (originSecret) h['x-origin-verify'] = originSecret
    return h
  }

  async function hitMcp(apiKey: string): Promise<{ status: number | 'error'; latencyMs: number }> {
    const t0 = Date.now()
    try {
      const res = await fetch(`${args.url}/api/mcp`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      return { status: res.status, latencyMs: Date.now() - t0 }
    } catch {
      return { status: 'error', latencyMs: Date.now() - t0 }
    }
  }

  async function hitAgent(apiKey: string): Promise<{ status: number | 'error'; latencyMs: number }> {
    const t0 = Date.now()
    try {
      const res = await fetch(`${args.url}/api/v1/agent/tickets?limit=1`, {
        method: 'GET',
        headers: headers(apiKey),
      })
      return { status: res.status, latencyMs: Date.now() - t0 }
    } catch {
      return { status: 'error', latencyMs: Date.now() - t0 }
    }
  }

  async function runWorker(org: TestOrg, route: 'mcp' | 'agent'): Promise<WorkerResult> {
    const samples: RequestSample[] = []
    const targetPerMin = org.ceiling * args.overshoot
    const intervalMs = Math.max(10, 60_000 / targetPerMin)
    const start = Date.now()
    const deadline = start + args.durationSec * 1000

    while (Date.now() < deadline && !interrupted) {
      const hit = route === 'mcp' ? await hitMcp(org.apiKey) : await hitAgent(org.apiKey)
      samples.push({ tSec: (Date.now() - start) / 1000, status: hit.status, latencyMs: hit.latencyMs })
      const elapsed = Date.now() - start
      const nextAt = samples.length * intervalMs
      const wait = nextAt - elapsed
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }

    return { orgId: org.orgId, planId: org.planId, ceiling: org.ceiling, route, samples }
  }

  console.log(`Running load for ${args.durationSec}s against: ${[...args.routes].join(', ')}...`)
  const workers: Promise<WorkerResult>[] = []
  for (const org of testOrgs) {
    for (const route of args.routes) {
      workers.push(runWorker(org, route))
    }
  }
  results.push(...(await Promise.all(workers)))
  console.log('Load finished. Analyzing...\n')

  // --- Analysis ---
  let anyDoubleAdmit = false
  const table: string[] = []
  table.push(
    'plan'.padEnd(11) + 'route'.padEnd(7) + 'ceiling'.padEnd(9) + 'sent'.padEnd(7) + '2xx'.padEnd(6) +
    '429'.padEnd(6) + 'err'.padEnd(6) + 'p50ms'.padEnd(8) + 'p95ms'.padEnd(8) + 'p99ms'.padEnd(8) + 'max/60s-window'
  )

  for (const r of results) {
    const ok = r.samples.filter((s) => typeof s.status === 'number' && s.status >= 200 && s.status < 300)
    const limited = r.samples.filter((s) => s.status === 429)
    const errored = r.samples.filter((s) => s.status === 'error' || (typeof s.status === 'number' && s.status >= 500))
    const lat = ok.map((s) => s.latencyMs).sort((a, b) => a - b)

    // Client-side approximation of the server's per-org 60s window: bucket
    // successes by floor(tSec/60). Boundary drift vs. the server's actual
    // window start (set by whichever request lands first) means this can be
    // off by a request or two — a real double-admit shows up as a bucket
    // meaningfully over ceiling, not by one.
    const byWindow = new Map<number, number>()
    for (const s of ok) {
      const w = Math.floor(s.tSec / 60)
      byWindow.set(w, (byWindow.get(w) ?? 0) + 1)
    }
    const maxWindow = Math.max(0, ...byWindow.values())
    const doubleAdmit = maxWindow > r.ceiling * 1.1 // 10% slack for boundary drift
    if (doubleAdmit) anyDoubleAdmit = true

    table.push(
      r.planId.padEnd(11) + r.route.padEnd(7) + String(r.ceiling).padEnd(9) + String(r.samples.length).padEnd(7) +
      String(ok.length).padEnd(6) + String(limited.length).padEnd(6) + String(errored.length).padEnd(6) +
      String(percentile(lat, 50)).padEnd(8) + String(percentile(lat, 95)).padEnd(8) + String(percentile(lat, 99)).padEnd(8) +
      `${maxWindow}${doubleAdmit ? '  ⚠️ DOUBLE-ADMIT' : ''}`
    )
  }

  console.log(table.join('\n'))
  console.log('')
  console.log(
    anyDoubleAdmit
      ? '⚠️  At least one org exceeded its plan ceiling within a single ~60s window — the shared limiter did not hold under this concurrency. Investigate before raising any tier\'s limit.'
      : '✅ No org exceeded its plan ceiling in any observed ~60s window at this concurrency.'
  )
  const anyErrors = results.some((r) => r.samples.some((s) => s.status === 'error' || (typeof s.status === 'number' && s.status >= 500)))
  if (anyErrors) {
    console.log('⚠️  Errors/timeouts occurred — check app logs for DB pool exhaustion or connection errors at this concurrency; that is the actual breaking point signal this test exists to find.')
  }

  if (!args.keep) {
    console.log('\nCleaning up test rows...')
    const orgIds = testOrgs.map((o) => o.orgId)
    await db.delete(apiKeys).where(inArray(apiKeys.orgId, orgIds))
    await db.delete(subscriptions).where(inArray(subscriptions.orgId, orgIds))
    await db.delete(orgs).where(inArray(orgs.id, orgIds))
    console.log('Done.')
  } else {
    console.log(`\n--keep passed — leaving ${testOrgs.length} test orgs in place (prefix: loadtest-*-${runId}).`)
  }
}

main().catch((err) => {
  console.error('Load test failed:', err)
  process.exit(1)
})
