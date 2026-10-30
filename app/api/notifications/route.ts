import { NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getRecentNotifications, getUnreadCount } from '@/lib/db/queries/notifications'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/notifications'

export const dynamic = 'force-dynamic'

// The bell's dropdown: the signed-in workspace's recent notifications and its
// unread count. Opened on demand, so the dashboard layout never loads the list.
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 401 })
    const [notifications, unread] = await Promise.all([
      getRecentNotifications(access.orgId),
      getUnreadCount(access.orgId),
    ])
    return NextResponse.json({ notifications, unread }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    logger.error('failed to load notifications', { module: MOD, requestId: getRequestId(request), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
