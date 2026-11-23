import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { enqueueDocsReprocess } from '@/lib/github/docs-reprocess'
import { getDeploymentMode } from '@/lib/billing/plans'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Called only by the bot's docs re-processing sweep (bot/index.ts) with
// BOT_SECRET, the same pattern as /api/kb/retitle-imports/run. Queues one sync
// for each repo whose synced docs predate the current cleanup rules
// (lib/github/docs-reprocess.ts). A self-hosted install has no included
// model, so its repos re-process on their next push or Sync now instead.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })
  if (getDeploymentMode() === 'self-hosted') return Response.json({ ok: true, queued: 0 })
  const { queued } = await enqueueDocsReprocess()
  return Response.json({ ok: true, queued })
}
