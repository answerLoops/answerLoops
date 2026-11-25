import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import {
  isEmbedAllowed,
  normalizeHost,
  parseAllowedOrigins,
  resolveEmbedOrigin,
} from '@/lib/widget/origin'
import { mintRenderToken } from '@/lib/widget/render-token'
import { WidgetChat } from './widget-chat'
import { EmbedRefused } from './embed-refused'
import { clientIp } from '@/lib/http/client-ip'
import { rateLimitShared } from '@/lib/ratelimit'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { getWidgetLogoVersion } from '@/lib/db/queries/widget-logos'
import { widgetLogoPath } from '@/lib/widget/logo'
import { brandPalette } from '@/lib/widget/appearance'

export const dynamic = 'force-dynamic'

// Each allowed render mints a short-lived token that unlocks the chat and lead
// endpoints, so minting is throttled per client address and per widget.
// Generous for a real visitor (one render per page view) and tight enough that
// a script cannot farm tokens.
const RENDER_IP_MAX = 30
const RENDER_IP_WINDOW_MS = 60_000
const RENDER_TOKEN_MAX = 600
const RENDER_TOKEN_WINDOW_MS = 60_000

// Widget tokens are 48 hex characters (see lib/db/queries/widgets.ts); checked
// before the value is used as rate-limit key material.
const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

interface Props {
  params: Promise<{ widgetToken: string }>
}

export default async function WidgetPage({ params }: Props) {
  const { widgetToken } = await params
  if (!WIDGET_TOKEN_PATTERN.test(widgetToken)) notFound()
  const org = await getOrgByWidgetToken(widgetToken)
  if (!org) notFound()

  // The allowlist is enforced here rather than on the chat endpoint because
  // this is the only request that carries the embedding page's identity. The
  // chat call is made from inside this iframe and is same-origin to us, so its
  // Origin header is our own hostname — see lib/widget/origin.ts.
  const headerList = await headers()
  const embedOrigin = resolveEmbedOrigin(headerList.get('referer'))
  const selfHost = normalizeHost(headerList.get('host'))
  const decision = isEmbedAllowed(
    embedOrigin,
    parseAllowedOrigins(org.widget_allowed_origins),
    selfHost
  )

  if (!decision.allowed) {
    // Rendered rather than 404'd so whoever embedded it sees why, in the panel
    // where they expect the chat. A blank iframe would send them hunting
    // through logs for a configuration step nobody told them about.
    return <EmbedRefused reason={decision.reason ?? 'origin-not-allowed'} origin={embedOrigin} />
  }

  const ip = clientIp({ headers: headerList })
  const [ipLimit, tokenLimit] = await Promise.all([
    rateLimitShared(`widget-render-ip:${ip}`, RENDER_IP_MAX, RENDER_IP_WINDOW_MS),
    rateLimitShared(`widget-render-token:${widgetToken}`, RENDER_TOKEN_MAX, RENDER_TOKEN_WINDOW_MS),
  ])
  if (!ipLimit.ok || !tokenLimit.ok) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-6">
        <p className="max-w-xs text-center text-sm text-gray-600">
          This chat is busy right now. Please try again in a minute.
        </p>
      </div>
    )
  }

  const whiteLabel = await orgHasFeature(org.id, 'white_label_widget')

  // Title, welcome message and brand color are customization, so they apply only
  // on a plan that includes it, the same check that removes the answerLoops
  // branding. Anything else gets the default look.
  const appearance = whiteLabel ? org.widget_appearance : null
  const brandStyle = appearance?.brandColor ? brandPalette(appearance.brandColor) : null
  // The workspace's own logo, on the same plan check. Without one (or without the
  // plan) the chat shows the answerLoops mark.
  const logo = whiteLabel ? await getWidgetLogoVersion(org.id) : null
  const logoUrl = logo ? widgetLogoPath(widgetToken, logo.etag) : null

  // Only true when this request is embedded on the org's own instance (the
  // Settings preview link, or a self-host testing the widget on localhost) —
  // never on a real customer's site, since isEmbedAllowed above already
  // required embedOrigin === selfHost for this branch when it's true.
  // Gates whether the chat route's config-error message names the missing
  // AI provider: safe for the org owner testing their own setup, but never
  // shown to an anonymous customer-site visitor (see NoAIProviderConfiguredError
  // handling in app/api/widget/chat/route.ts).
  const isSelfPreview = embedOrigin !== null && embedOrigin === selfHost

  // Minted only now that isEmbedAllowed() has passed, and required by the
  // chat/lead endpoints on every call — see lib/widget/render-token.ts for
  // why the allowlist above otherwise gates nothing but this page's own render.
  // Bound to this client address: the iframe's later fetches come from the
  // same browser, so a token copied elsewhere does not verify.
  const renderToken = mintRenderToken(widgetToken, ip)

  // Visitors can flag an answer on the plans that have the Review queue, which
  // is where those flags are read. Not in the owner's own preview, where a test
  // question would otherwise be flagged into their real list. That preview is
  // the Settings link opened as its own tab, which the browser reports as a
  // top-level "document" request. A widget embedded in a page on this same
  // instance (our own marketing and docs pages, or a self-host's own site) is
  // also "self" by referer, but is a real visitor in an iframe, so it keeps the
  // thumbs. The browser sets this header and a page cannot change it.
  const openedAsOwnTab = isSelfPreview && headerList.get('sec-fetch-dest') === 'document'
  const answerFlagsEnabled = !openedAsOwnTab && (await orgHasFeature(org.id, 'kb_review_queue'))

  return (
    <WidgetChat
      widgetToken={widgetToken}
      renderToken={renderToken}
      orgName={org.name}
      showBranding={!whiteLabel}
      isSelfPreview={isSelfPreview}
      leadCaptureMode={org.widget_lead_capture_mode}
      title={appearance?.title ?? null}
      welcome={appearance?.welcome ?? null}
      starterQuestions={appearance?.starterEnabled ? appearance.starterQuestions : []}
      brandStyle={brandStyle}
      logoUrl={logoUrl}
      answerFlagsEnabled={answerFlagsEnabled}
    />
  )
}
