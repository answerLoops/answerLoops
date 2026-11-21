import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { runWidgetLeadDigests } from '@/lib/widget/lead-notifications'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/widget/lead-notifications/run'

// Called only by the bot's lead-email sweep (bot/index.ts) with BOT_SECRET, the
// same pattern as /api/billing/trial-reminders/run. The mail provider and the
// public origin are configured on the app service, so the bot just keeps the
// sweep running. Each workspace's turn to send is claimed in the database, so a
// repeat or overlapping run never sends the same leads twice.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })
  try {
    return Response.json({ ok: true, ...(await runWidgetLeadDigests()) })
  } catch (err) {
    logger.error('widget lead digest run failed', { module: MOD, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
