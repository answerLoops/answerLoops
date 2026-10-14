import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { listMigrationCandidates, runEmbeddingMigration } from '@/lib/kb/embedding-migration'
import { getPlatformModel } from '@/lib/ai/platform-models'
import { getDeploymentMode } from '@/lib/billing/plans'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/kb/embedding-migration/run'

// Called only by the bot's embedding-migration sweep (bot/index.ts) with
// BOT_SECRET, the same pattern as /api/ingest/retry-stuck. Model config is
// read here, in the app, so the bot service needs no copy of it.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })
  const platformModel = getDeploymentMode() === 'self-hosted' ? DEFAULT_EMBEDDING_MODEL : getPlatformModel('embedding')
  if (!platformModel) return Response.json({ ok: true, orgs: 0 })
  const orgs = await listMigrationCandidates(platformModel)
  for (const orgId of orgs) {
    try {
      await runEmbeddingMigration(orgId)
    } catch (err) {
      // One workspace failing must not block the rest; the next sweep retries it.
      logger.error('embedding migration failed', { module: MOD, orgId, error: err })
    }
  }
  return Response.json({ ok: true, orgs: orgs.length })
}
