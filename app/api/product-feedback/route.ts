import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getBoardSnapshot } from '@/lib/db/queries/product-feedback'
import { isFeedbackWidgetEnabled } from '@/lib/product-feedback/enabled'
import { parseBoardSort } from '@/lib/product-feedback/validation'

export const dynamic = 'force-dynamic'

// Snapshot for the dashboard feedback widget. Per-viewer: approved feedback for
// everyone, plus the caller's own pending rows, in the order `?sort=` asks for
// (newest by default, or votes). The widget calls this on mount, when the sort
// changes, and again whenever the live stream signals `feedback_changed`.
export async function GET(request: Request) {
  // Off by default: a deployment that never enabled the board has no such route.
  if (!isFeedbackWidgetEnabled()) return new NextResponse('Not found', { status: 404 })

  const session = await auth()
  const userId = Number(session?.user?.id)
  if (!session?.user || !Number.isInteger(userId) || userId < 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sort = parseBoardSort(new URL(request.url).searchParams.get('sort'))
  const snapshot = await getBoardSnapshot({ userId, sort })
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
}
