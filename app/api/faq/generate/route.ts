import { requireOrgAccess } from '@/lib/auth/org'
import { getResolvedTicketsThisWeek, insertFAQSnapshot } from '@/lib/db/queries/faq'
import { generateFAQ } from '@/lib/ai/faq-generator'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/faq/generate'

export async function POST(req: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  try {
    const tickets = await getResolvedTicketsThisWeek(orgId)

    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + 1) // Monday
    weekStart.setHours(0, 0, 0, 0)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6) // Sunday

    let content: string
    try {
      content = await generateFAQ(tickets, orgId)
    } catch (err) {
      if (err instanceof NoAIProviderConfiguredError) {
        return Response.json({ error: 'No AI provider configured — connect one in Settings → AI Model to generate an FAQ.' }, { status: 503 })
      }
      throw err
    }
    const snapshot = await insertFAQSnapshot(
      weekStart.toISOString().split('T')[0],
      weekEnd.toISOString().split('T')[0],
      content,
      tickets.length,
      orgId
    )

    return Response.json({ ok: true, snapshot_id: snapshot.id, ticket_count: tickets.length })
  } catch (err) {
    logger.error('faq generation failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
