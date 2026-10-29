import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { getDeploymentMode } from '@/lib/billing/plans'
import { runTrialReminders } from '@/lib/billing/trial-reminders'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/billing/trial-reminders/run'

// Called only by the bot's trial-reminder sweep (bot/index.ts) with BOT_SECRET,
// the same pattern as /api/kb/embedding-migration/run. The mail provider and the
// public origin are configured on the app service, so the bot just keeps the
// sweep running.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })
  // Only the hosted service runs trials.
  if (getDeploymentMode() !== 'cloud') return Response.json({ ok: true, considered: 0, sent: 0, failed: 0 })
  try {
    return Response.json({ ok: true, ...(await runTrialReminders()) })
  } catch (err) {
    logger.error('trial reminder run failed', { module: MOD, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
