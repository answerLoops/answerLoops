import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { listMigrationCandidates, runEmbeddingMigration } from '@/lib/kb/embedding-migration'
import { getPlatformModel } from '@/lib/ai/platform-models'
import { getDeploymentMode } from '@/lib/billing/plans'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/kb/embedding-migration/run'

/** No new workspace is started once a request has run this long; the next sweep picks up the rest. */
export const ROUTE_TIME_BUDGET_MS = 4 * 60_000

// Called only by the bot's embedding-migration sweep (bot/index.ts) with
// BOT_SECRET, the same pattern as /api/ingest/retry-stuck. Model config is
// read here, in the app, so the bot service needs no copy of it.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })
  const platformModel = getDeploymentMode() === 'self-hosted' ? DEFAULT_EMBEDDING_MODEL : getPlatformModel('embedding')
  if (!platformModel) return Response.json({ ok: true, orgs: 0 })
  const started = Date.now()
  const orgs = await listMigrationCandidates(platformModel)
  let ran = 0
  for (const orgId of orgs) {
    if (Date.now() - started >= ROUTE_TIME_BUDGET_MS) break
    ran++
    try {
      await runEmbeddingMigration(orgId)
    } catch (err) {
      // One workspace failing must not block the rest; it backs off and a
      // later sweep retries it.
      logger.error('embedding migration failed', { module: MOD, orgId, error: err })
    }
  }
  return Response.json({ ok: true, orgs: ran })
}
