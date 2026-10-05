/**
 * Origin allowlisting for the embedded chat widget.
 *
 * ## Where this can be enforced, and where it cannot
 *
 * The embed is two hops. `public/widget.js` runs on the customer's page and
 * creates an iframe pointing at `/widget/<token>` on *our* domain. The chat
 * request is then made from inside that iframe, so it is same-origin to us —
 * its `Origin` header is our own hostname, never the customer's.
 *
 * That means the allowlist decision itself cannot be made at `/api/widget/chat`:
 * the parent page's identity is simply not present on that request. The only
 * point where it is visible is the **iframe navigation**, where the browser
 * sends the embedding page as `Referer`, reduced to a bare origin cross-site
 * by this app's `Referrer-Policy`. The decision made here is carried forward
 * to the chat/lead endpoints via a short-lived signed token minted only on an
 * allowed render — see lib/widget/render-token.ts — so a caller who never
 * passed this check has nothing valid to present there.
 *
 * `Referer` is the only signal used, and deliberately so: it is the one value
 * on this request the embedding page does not author. Inputs that the caller
 * writes are not accepted as a substitute, which means pages that send no
 * referrer cannot embed. That is a known and accepted limitation of the
 * design.
 *
 * Scope and rationale are recorded on the internal security page.
 */

/** Parse the stored newline/comma-separated list into normalised hostnames. */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[\n,]/)
    .map((entry) => normalizeHost(entry))
    .filter((entry): entry is string => Boolean(entry))
}

/**
 * Reduce a user-entered value to a bare lowercase hostname. Accepts what people
 * actually paste — `https://example.com/`, `example.com:8443`, ` Example.com `
 * — because a config field that rejects a pasted URL just produces support
 * tickets. Port is dropped: a host is trusted or it is not, regardless of port.
 */
export function normalizeHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return null

  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  try {
    return new URL(withScheme).hostname || null
  } catch {
    return null
  }
}

/**
 * The origin the widget is being embedded on, taken from the iframe
 * navigation's `Referer` and nothing else.
 *
 * A browser sets this header itself and page script cannot alter it, which is
 * the entire reason it is trustworthy here. Any value the embedding page can
 * choose — a query parameter, a custom header — is worthless for this purpose,
 * because the party we are trying to exclude is the one supplying it.
 */
export function resolveEmbedOrigin(referer: string | null): string | null {
  return normalizeHost(referer)
}

export interface EmbedDecision {
  allowed: boolean
  /** Populated when refused, for the operator-facing message. */
  reason?: 'not-configured' | 'origin-not-allowed' | 'origin-unknown'
}

/**
 * Whether the widget may render for this org on this embedding origin.
 *
 * Deny by default: an org with no configured domains cannot be embedded
 * anywhere except its own instance. There is no backwards-compatibility case to
 * preserve — the allowlist ships with the feature, so no embed predates it —
 * and an opt-in security control protects only the people who already thought
 * about it.
 *
 * `selfHost` is always allowed so the Settings preview link and any embed on
 * the instance's own domain keep working without configuration.
 */
export function isEmbedAllowed(
  embedOrigin: string | null,
  allowed: string[],
  selfHost: string | null
): EmbedDecision {
  if (embedOrigin && selfHost && embedOrigin === selfHost) return { allowed: true }
  if (!embedOrigin) return { allowed: false, reason: 'origin-unknown' }
  if (allowed.length === 0) return { allowed: false, reason: 'not-configured' }

  const match = allowed.some(
    (entry) => embedOrigin === entry || embedOrigin.endsWith(`.${entry}`)
  )
  return match ? { allowed: true } : { allowed: false, reason: 'origin-not-allowed' }
}
