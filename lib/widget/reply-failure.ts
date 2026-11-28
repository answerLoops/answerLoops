/**
 * What the widget tells a visitor when a reply does not come through. Only
 * these words are shown, never a status code, a server message or an error
 * name, including in the workspace owner's own preview; the detail goes to the
 * browser console instead. The "session timed out" case (an expired pass,
 * HTTP 403) has its own recovery in the chat and is not handled here.
 */

export type ReplyFailure = 'offline' | 'busy' | 'general'

export const REPLY_FAILURE_COPY: Record<ReplyFailure, string> = {
  offline: "It looks like you're offline. Check your connection and try again.",
  busy: "We're a little busy right now. Please try again in a moment.",
  general: "Sorry, that didn't go through. Please try again.",
}

/** Statuses that mean "try again shortly": rate limited, or the service briefly unavailable. */
const BUSY_STATUSES = new Set([429, 502, 503, 504])

/**
 * Sorts a failed reply into the message the visitor sees. `online` is the
 * browser's own connection state (navigator.onLine). The error text is only
 * read to classify it, never shown.
 */
export function classifyReplyFailure(errorMessage: string, online: boolean): ReplyFailure {
  if (!online) return 'offline'
  const status = /^HTTP (\d{3})\b/.exec(errorMessage)
  if (status) return BUSY_STATUSES.has(Number(status[1])) ? 'busy' : 'general'
  // A request that never got a response: the browser reports these as network
  // errors rather than an HTTP status.
  if (/failed to fetch|networkerror|network error|load failed|network request failed/i.test(errorMessage)) {
    return 'offline'
  }
  return 'general'
}
