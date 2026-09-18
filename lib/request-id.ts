import type { NextRequest } from 'next/server'

/**
 * middleware.ts stamps every request with this header before it reaches a
 * route handler. The fallback only fires for callers that bypass
 * middleware — direct unit tests invoking a route's GET/POST export.
 */
export function getRequestId(req: NextRequest | Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID()
}
