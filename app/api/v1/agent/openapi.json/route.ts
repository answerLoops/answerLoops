import { buildAgentOpenApiSpec } from '@/lib/agent/openapi-spec'

/**
 * GET /api/v1/agent/openapi.json
 *
 * Real OpenAPI 3.1 spec for the Agent API — the spec object itself lives in
 * lib/agent/openapi-spec.ts and is also served at /openapi.json (the root
 * location agent scanners probe). public/.well-known/ai-plugin.json's
 * api.url points here.
 *
 * scripts/generate-api-reference imports this handler and calls it with no
 * argument, so `req` is optional: with a request we advertise the origin it
 * came in on (self-hosting), without one we fall back to the canonical URL.
 */
export function GET(req?: Request) {
  const origin = req ? new URL(req.url).origin : undefined
  return Response.json(buildAgentOpenApiSpec(origin))
}
