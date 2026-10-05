import { requireOrgAccess } from '@/lib/auth/org'
import { getTickets } from '@/lib/db/queries/tickets'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { escapeCSV } from '@/lib/csv'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/export/tickets'

export async function GET(req: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return new Response(access.error, { status: 401 })

  const orgId = access.orgId

  try {
    if (!(await orgHasFeature(orgId, 'csv_export'))) {
      return new Response('Forbidden', { status: 403 })
    }

    const tickets = await getTickets({}, orgId)

    const header = ['id', 'status', 'priority', 'category', 'ai_summary', 'content', 'source_author_name', 'created_at', 'resolved_at']
    const rows = tickets.map((t) => [
      t.id,
      t.status,
      t.priority,
      t.category ?? '',
      t.ai_summary ?? '',
      t.content,
      t.source_author_name ?? '',
      t.created_at,
      t.resolved_at ?? '',
    ].map(escapeCSV).join(','))

    const csv = [header.join(','), ...rows].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (err) {
    logger.error('tickets csv export failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
