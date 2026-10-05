import { requireOrgAccess } from '@/lib/auth/org'
import { listWidgetLeads } from '@/lib/db/queries/widget-leads'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { escapeCSV } from '@/lib/csv'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/export/leads'

export async function GET(req: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return new Response(access.error, { status: 401 })

  const orgId = access.orgId

  try {
    if (!(await orgHasFeature(orgId, 'csv_export'))) {
      return new Response('Forbidden', { status: 403 })
    }

    const leads = await listWidgetLeads(orgId)

    const header = ['id', 'email', 'widget_token', 'created_at']
    const rows = leads.map((l) => [l.id, l.email, l.widgetToken, l.createdAt].map(escapeCSV).join(','))

    const csv = [header.join(','), ...rows].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (err) {
    logger.error('leads csv export failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
