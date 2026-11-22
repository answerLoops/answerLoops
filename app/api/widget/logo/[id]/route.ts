import { getOrgByWidgetSlug, getOrgByWidgetToken, type WidgetOrg } from '@/lib/db/queries/widgets'
import { getWidgetLogo } from '@/lib/db/queries/widget-logos'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { rateLimitShared } from '@/lib/ratelimit'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { WIDGET_TOKEN_PATTERN, isWidgetSlug } from '@/lib/widget/slug'
import { logoVersionMatches } from '@/lib/widget/logo'
import { logger } from '@/lib/logger'

const MOD = 'api/widget/logo'

// The chat and the launcher both load this once per open, so the limits suit a
// busy site behind one address. Per-IP bounds a single caller, per-identifier
// bounds hammering one widget from many addresses; both are charged on every
// request.
const IP_MAX = 240
const IP_WINDOW_MS = 60_000
const ID_MAX = 2_400
const ID_WINDOW_MS = 60_000

// A request that names the current version (?v=) is for an image that will
// never change at that address, so it may be kept longer; a request without
// one, or with an old one, gets a short-lived copy that is refreshed soon.
const CACHE_VERSIONED = 'public, max-age=3600, s-maxage=300, stale-while-revalidate=600'
const CACHE_UNVERSIONED = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'

const NOT_FOUND_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=60', 'X-Content-Type-Options': 'nosniff' }

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS })
}

async function findOrg(id: string): Promise<WidgetOrg | null> {
  if (WIDGET_TOKEN_PATTERN.test(id)) return getOrgByWidgetToken(id)
  if (isWidgetSlug(id)) return getOrgByWidgetSlug(id)
  return null
}

/**
 * Public: serves a workspace's own chat logo, named by the widget token or
 * public name the embed already uses. Only while the workspace's plan still
 * includes customization; otherwise (and when there is no logo) it is a 404 and
 * the chat shows the answerLoops mark.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  const { id: rawId } = await ctx.params
  const id = (rawId ?? '').trim()
  // Rejected on shape before the value becomes rate-limit key material or a
  // database parameter.
  if (!WIDGET_TOKEN_PATTERN.test(id) && !isWidgetSlug(id)) return notFound()

  try {
    const ip = clientIp(request)
    const [ipLimit, idLimit] = await Promise.all([
      rateLimitShared(`widget-logo-ip:${ip}`, IP_MAX, IP_WINDOW_MS),
      rateLimitShared(`widget-logo-id:${id}`, ID_MAX, ID_WINDOW_MS),
    ])
    if (!ipLimit.ok || !idLimit.ok) {
      return new Response('Too many requests', { status: 429, headers: { 'Cache-Control': 'no-store' } })
    }

    const org = await findOrg(id)
    if (!org) return notFound()
    if (!(await orgHasFeature(org.id, 'white_label_widget'))) return notFound()

    const logo = await getWidgetLogo(org.id)
    if (!logo) return notFound()

    const requested = new URL(request.url).searchParams.get('v')
    const versioned = logoVersionMatches(requested, logo.etag)
    const headers: Record<string, string> = {
      'Content-Type': logo.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': versioned ? CACHE_VERSIONED : CACHE_UNVERSIONED,
      ETag: `"${logo.etag}"`,
    }

    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === `"${logo.etag}"`)) {
      return new Response(null, { status: 304, headers })
    }

    return new Response(new Uint8Array(logo.bytes), { status: 200, headers: { ...headers, 'Content-Length': String(logo.bytes.length) } })
  } catch (error) {
    logger.error('widget logo lookup failed', { module: MOD, error })
    return new Response('Service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
