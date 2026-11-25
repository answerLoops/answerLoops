/**
 * The address a workspace's chat logo is served from, and the version number
 * the embed script is given for it.
 *
 * The address carries the logo's version (a short fingerprint of the stored
 * image), so a replaced logo has a new address and shows up straight away
 * instead of waiting for a cached copy to expire.
 */
export const WIDGET_LOGO_VERSION_PATTERN = /^[0-9a-f]{16}$/

/** What `?v=` may hold on a request: the fingerprint, or its number form (digits only, bounded). */
export const WIDGET_LOGO_REQUEST_VERSION_PATTERN = /^(?:[0-9a-f]{16}|[0-9]{1,16})$/

/** The path a workspace's logo is served from: the widget token and the logo's version. */
export function widgetLogoPath(widgetToken: string, version: string): string {
  return `/api/widget/logo/${widgetToken}?v=${version}`
}

/**
 * The logo's version as a plain whole number: the first 10 hex characters of
 * its fingerprint (at most 2^40, a safe integer). It changes whenever the
 * image does. The embed script builds the logo address from this number, the
 * widget token and its own base address, so no address is ever sent to it.
 */
export function widgetLogoVersionNumber(etag: string): number | null {
  if (!WIDGET_LOGO_VERSION_PATTERN.test(etag)) return null
  return parseInt(etag.slice(0, 10), 16)
}

/** True when a `?v=` value on a logo request names this fingerprint, in either form. */
export function logoVersionMatches(requested: string | null, etag: string): boolean {
  if (requested === null || !WIDGET_LOGO_REQUEST_VERSION_PATTERN.test(requested)) return false
  if (requested === etag) return true
  const n = widgetLogoVersionNumber(etag)
  return n !== null && requested === String(n)
}
