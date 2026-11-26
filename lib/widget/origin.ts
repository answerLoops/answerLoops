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
 * sends the embedding page as `Referer`. How much of that address is sent is
 * up to the embedding page's own referrer policy, not ours: the default sends
 * the bare origin cross-site, and a page set to `no-referrer` sends nothing,
 * which the refusal page explains to its owner. The decision made here is carried forward
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

import { parse as parseDomain } from 'tldts'

/**
 * Whether a hostname names a site rather than a shared ending that many
 * unrelated sites sit under. Each entry also covers its subdomains, so an entry
 * such as `com`, `co.uk`, `github.io` or `vercel.app` would match every site
 * under it. Those endings come from the Public Suffix List bundled with tldts,
 * including the hosting platforms in its private section. `localhost` and IP
 * addresses name a single machine and are fine.
 */
export function isListableHost(host: string): boolean {
  if (host === 'localhost' || host.startsWith('[')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  if (!host.split('.').every((label) => label.length > 0)) return false
  // A host that is itself a public suffix has no registrable domain.
  return parseDomain(host, { allowPrivateDomains: true }).domain !== null
}

/**
 * Split what an owner entered into the hostnames that can be used and the
 * entries that cannot (unreadable, or a whole top-level domain).
 */
export function splitAllowedOrigins(raw: string | null | undefined): { origins: string[]; rejected: string[] } {
  const origins: string[] = []
  const rejected: string[] = []
  for (const entry of (raw ?? '').split(/[\n,]/)) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const host = normalizeHost(trimmed)
    if (host && isListableHost(host)) {
      if (!origins.includes(host)) origins.push(host)
    } else {
      rejected.push(trimmed)
    }
  }
  return { origins, rejected }
}

/**
 * Parse the stored newline/comma-separated list into normalised hostnames.
 * Entries that could not be saved today (see isListableHost) are ignored, so a
 * list stored before that check never matches more sites than one domain.
 */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  return splitAllowedOrigins(raw).origins
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

interface EmbedDecision {
  allowed: boolean
  /** Populated when refused, for the operator-facing message. */
  reason?: 'not-configured' | 'origin-not-allowed' | 'origin-unknown'
  /**
   * Allowed only because the embedding page is on this instance's own host.
   * The caller decides whether that applies to this widget (see
   * lib/widget/own-host-embed.ts) and, if not, asks again with no own host.
   */
  viaOwnHost?: true
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
 * A page on `selfHost` is allowed and marked `viaOwnHost`, so the Settings
 * preview link and the instance's own pages work without configuration for
 * the widgets that may use them (lib/widget/own-host-embed.ts). Pass null for
 * `selfHost` to decide on the listed domains alone.
 */
export function isEmbedAllowed(
  embedOrigin: string | null,
  allowed: string[],
  selfHost: string | null
): EmbedDecision {
  if (embedOrigin && selfHost && embedOrigin === selfHost) return { allowed: true, viaOwnHost: true }
  if (!embedOrigin) return { allowed: false, reason: 'origin-unknown' }
  if (allowed.length === 0) return { allowed: false, reason: 'not-configured' }

  const match = allowed.some(
    (entry) => embedOrigin === entry || embedOrigin.endsWith(`.${entry}`)
  )
  return match ? { allowed: true } : { allowed: false, reason: 'origin-not-allowed' }
}
