import { NextResponse } from 'next/server'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { rateLimitShared } from '@/lib/ratelimit'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import {
  DEFAULT_WIDGET_DISPLAY,
  resolveWidgetDisplay,
  type WidgetDisplaySettings,
} from '@/lib/widget/display-settings'
import { logger } from '@/lib/logger'

const MOD = 'api/widget/config'

// Widget tokens are crypto.randomBytes(24).toString('hex') — see
// lib/db/queries/widgets.ts. Validated before the value becomes rate-limit key
// material or a database parameter, since the limiter persists whatever key it
// is given.
const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

// The embed script calls this once per page view, so the limits are set for a
// busy site behind one address (an office, a school) rather than for one person.
// Per-IP bounds a single caller; per-identifier bounds hammering one widget
// from many addresses. Both counters are charged on every request, so the
// stricter one always wins.
const IP_MAX = 120
const IP_WINDOW_MS = 60_000
const ID_MAX = 1_200
const ID_WINDOW_MS = 60_000

// Shared-cache freshness. This is how long a changed setting takes to reach
// pages that already cached the old answer, so it is kept short;
// stale-while-revalidate keeps the page fast while it refreshes.
const CACHEABLE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'
const UNCACHEABLE = 'no-store'

// The response carries nothing private and is read by a script running on the
// customer's own site, so any origin may read it. No credentials are involved.
const CORS = { 'Access-Control-Allow-Origin': '*' }

interface ConfigBody {
  display: WidgetDisplaySettings
}

function respond(body: ConfigBody, cacheControl: string, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS, 'Cache-Control': cacheControl } })
}

// Harmless: today's look. Used for anything unknown, expired or malformed, so
// the script never meets an error it has to understand.
function defaults(cacheControl: string, status = 200): NextResponse {
  return respond({ display: { ...DEFAULT_WIDGET_DISPLAY } }, cacheControl, status)
}

/**
 * Public lookup for the embed script: given the `data-widget-id` from the
 * install snippet, returns how this business wants the widget to look.
 * Display settings only; nothing about the workspace is returned.
 */
export async function GET(request: Request): Promise<Response> {
  // Before clientIp() below trusts the proxy-supplied client-IP header.
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  const id = new URL(request.url).searchParams.get('id')?.trim() ?? ''

  if (!WIDGET_TOKEN_PATTERN.test(id)) return defaults(CACHEABLE)

  try {
    const ip = clientIp(request)
    const [ipLimit, idLimit] = await Promise.all([
      rateLimitShared(`widget-config-ip:${ip}`, IP_MAX, IP_WINDOW_MS),
      rateLimitShared(`widget-config-id:${id}`, ID_MAX, ID_WINDOW_MS),
    ])
    if (!ipLimit.ok || !idLimit.ok) {
      // A throttled answer must not be cached: it would turn one noisy caller
      // into a lookup failure for everyone behind the same edge.
      return defaults(UNCACHEABLE, 429)
    }

    const org = await getOrgByWidgetToken(id)
    if (!org) return defaults(CACHEABLE)

    // Nothing is stored per business yet beyond the defaults, so the plan check
    // runs on an empty selection; the resolver is where a chosen size or color
    // is limited to what the plan includes once those settings exist.
    const customization = await orgHasFeature(org.id, 'white_label_widget')
    return respond({ display: resolveWidgetDisplay(null, { customization }) }, CACHEABLE)
  } catch (error) {
    // A failed lookup must degrade to today's look, not an error page.
    logger.error('widget config lookup failed', { module: MOD, error })
    return defaults(UNCACHEABLE, 503)
  }
}
