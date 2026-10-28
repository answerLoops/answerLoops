import { NextResponse } from 'next/server'
import { marketingSiteEnabled, MARKETING_URL } from '@/lib/site'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/site/changelog-link'

// Backs the "What's new" link in the dashboard sidebar
// (components/dashboard/sidebar-nav.tsx).
//
// marketingSiteEnabled() reads DEPLOYMENT_MODE at request time, which a client
// bundle cannot see — Next only inlines NEXT_PUBLIC_* at build time, and this
// must follow the runtime value. So the sidebar asks the server instead, the
// same way nav-state/route.ts does for the marketing header CTA.
//
// A self-hosted install serves no marketing site, so /changelog 404s there.
// Returning show: false lets the sidebar drop the link entirely, rather than
// rendering a dead one.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (!marketingSiteEnabled()) {
      return NextResponse.json(
        { show: false },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    return NextResponse.json(
      { show: true, href: `${MARKETING_URL}/changelog` },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (err) {
    logger.error('failed to resolve changelog link', { module: MOD, requestId: getRequestId(request), error: err })
    // Fail closed: no link beats a link to a page that may not exist.
    return NextResponse.json(
      { show: false },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
