import { isOrgMember } from '@/lib/auth/membership'
import { getDeploymentMode } from '@/lib/billing/plans'
import { siteChatWidgetId } from '@/lib/site'

/**
 * Whether a workspace's widget may open on this instance's own host without
 * that host being in the workspace's allowed domains (see isEmbedAllowed in
 * lib/widget/origin.ts, which reports such a match as `viaOwnHost`).
 *
 * - A self-hosted instance: yes. The instance's own domain is the operator's
 *   site, so a widget embedded there or opened from Settings needs no setup.
 * - The instance's own site widget (SITE_CHAT_WIDGET_ID), which our docs and
 *   marketing pages embed: yes.
 * - Otherwise, only for someone signed in as a member of that workspace, which
 *   is the Settings → Widget preview link. Other widgets on the hosted service
 *   open only on the domains their owner listed.
 */
export async function mayOpenOnOwnHost(org: { id: number; widget_slug: string | null }, widgetToken: string): Promise<boolean> {
  if (getDeploymentMode() === 'self-hosted') return true

  const siteWidget = siteChatWidgetId()
  if (siteWidget && (siteWidget === widgetToken || (org.widget_slug !== null && siteWidget === org.widget_slug))) {
    return true
  }

  // Loaded only on this path: every other widget render (a visitor on a
  // customer's site) never needs the session.
  const { auth } = await import('@/auth')
  const session = await auth()
  const userId = session?.user?.id
  return userId ? isOrgMember(userId, org.id) : false
}
