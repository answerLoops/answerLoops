import { appOrigin } from '@/lib/site'

/**
 * The public origin the OpenAPI spec advertises in `servers`.
 *
 * `new URL(req.url).origin` is the origin the app server itself bound to, which
 * behind a reverse proxy or container is the internal address
 * (http://localhost:3000), not the host a caller actually reached. Order:
 * the configured app origin, then the proxy's forwarded host/proto, then the
 * request origin as a last resort. With no request (the docs generator) it
 * returns undefined so the spec falls back to the canonical hosted URL.
 */
export function openApiOrigin(req?: Request): string | undefined {
  if (!req) return undefined

  const configured = appOrigin()
  if (configured) return configured

  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (host) {
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
    try {
      return new URL(`${proto}://${host}`).origin
    } catch {
      // Malformed forwarded header — fall through to the request origin.
    }
  }

  return new URL(req.url).origin
}
