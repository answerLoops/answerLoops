const ACCEPT_TERMS_PATH = '/accept-terms'

/**
 * Only a relative path on this site, and never the terms step itself. The value
 * comes from the query string and ends up in a redirect, so anything else —
 * another origin, a protocol-relative or backslash form — falls back to the
 * dashboard.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/dashboard'
  if (raw === ACCEPT_TERMS_PATH || raw.startsWith(`${ACCEPT_TERMS_PATH}?`)) return '/dashboard'
  return raw
}
