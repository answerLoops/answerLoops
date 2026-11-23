import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { listRetitleCandidates, runRetitlePass } from '@/lib/kb/retitle-imports'
import { getDeploymentMode } from '@/lib/billing/plans'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/kb/retitle-imports/run'

/** No new workspace is started once a request has run this long; the next sweep picks up the rest. */
export const ROUTE_TIME_BUDGET_MS = 4 * 60_000

// Called only by the bot's re-title sweep (bot/index.ts) with BOT_SECRET, the
// same pattern as /api/kb/embedding-migration/run. Re-titles sections from
// pages imported before titles carried the page (lib/kb/retitle-imports.ts)
// for workspaces on the platform embedding model. A self-hosted install has
// no platform model, so its owner runs the pass from Settings instead.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })
  if (getDeploymentMode() === 'self-hosted') return Response.json({ ok: true, orgs: 0 })
  const started = Date.now()
  const orgs = await listRetitleCandidates()
  let ran = 0
  for (const orgId of orgs) {
    if (Date.now() - started >= ROUTE_TIME_BUDGET_MS) break
    ran++
    try {
      await runRetitlePass(orgId, { mode: 'scheduled' })
    } catch (err) {
      // One workspace failing must not block the rest; it backs off and a
      // later sweep retries it.
      logger.error('re-title pass failed', { module: MOD, orgId, error: err })
    }
  }
  return Response.json({ ok: true, orgs: ran })
}
