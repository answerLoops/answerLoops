import { buildAgentOpenApiSpec } from '@/lib/agent/openapi-spec'

/**
 * GET /openapi.json
 *
 * The conventional root location an agent looks for an OpenAPI description.
 * Identical to /api/v1/agent/openapi.json — both render lib/agent/openapi-spec.ts.
 * Kept as its own route (rather than a rewrite) so the response is a plain
 * 200 JSON body with no redirect hop for a scanner to follow. The `servers`
 * URL is the origin this request came in on, so a self-hosted instance
 * describes itself.
 */
export function GET(req?: Request) {
  const origin = req ? new URL(req.url).origin : undefined
  return Response.json(buildAgentOpenApiSpec(origin))
}
