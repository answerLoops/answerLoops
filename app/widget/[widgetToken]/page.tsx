import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import {
  isEmbedAllowed,
  normalizeHost,
  parseAllowedOrigins,
  resolveEmbedOrigin,
} from '@/lib/widget/origin'
import { WidgetChat } from './widget-chat'
import { EmbedRefused } from './embed-refused'
import { orgHasFeature } from '@/lib/billing/entitlements-server'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ widgetToken: string }>
}

export default async function WidgetPage({ params }: Props) {
  const { widgetToken } = await params
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

  const whiteLabel = await orgHasFeature(org.id, 'white_label_widget')

  // Only true when this request is embedded on the org's own instance (the
  // Settings preview link, or a self-host testing the widget on localhost) —
  // never on a real customer's site, since isEmbedAllowed above already
  // required embedOrigin === selfHost for this branch when it's true.
  // Gates whether the chat route's config-error message names the missing
  // AI provider: safe for the org owner testing their own setup, but never
  // shown to an anonymous customer-site visitor (see NoAIProviderConfiguredError
  // handling in app/api/widget/chat/route.ts).
  const isSelfPreview = embedOrigin !== null && embedOrigin === selfHost

  return (
    <WidgetChat
      widgetToken={widgetToken}
      orgName={org.name}
      showBranding={!whiteLabel}
      isSelfPreview={isSelfPreview}
    />
  )
}
