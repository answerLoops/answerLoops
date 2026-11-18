import Script from 'next/script'
import { siteChatWidgetId } from '@/lib/site'

/**
 * The answerLoops chat assistant on our own public pages: the marketing site
 * and the documentation. It is the same embeddable widget a customer puts on
 * their site, pointed at a workspace that holds our public docs, so a visitor
 * can try the product by asking it a question.
 *
 * Public pages only. This is never mounted inside the signed-in app, where
 * the workspace on screen belongs to a person and not to the site.
 *
 * Renders nothing unless SITE_CHAT_WIDGET_ID is set, so a self-hosted install
 * or a fresh clone has no assistant until its operator chooses one. The id is
 * read when the page is requested, which is why every page that mounts this is
 * rendered per request.
 */
export function SiteChatWidget() {
  const id = siteChatWidgetId()
  if (!id) return null
  return <Script src="/widget.js" data-widget-id={id} strategy="lazyOnload" />
}
