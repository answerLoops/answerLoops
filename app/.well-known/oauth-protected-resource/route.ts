import { ALL_SCOPES, API_SCOPES } from '@/lib/agent/scopes'

/**
 * GET /.well-known/oauth-protected-resource  (RFC 9728)
 *
 * Machine-readable declaration of this API's protected-resource metadata so
 * an agent can discover the exact set of least-privilege scopes before it
 * calls anything. The same scope names appear in the OpenAPI security
 * requirements (/openapi.json) and on each MCP tool's `_meta.requiredScope`.
 *
 * `authorization_servers` is deliberately omitted: keys are long-lived,
 * org-scoped credentials minted in Settings → API Keys, not tokens issued by
 * a separate OAuth authorization server. RFC 9728 makes that field optional.
 *
 * `resource` and the doc link are built from the origin this request came in
 * on, not a hardcoded host, so a self-hosted instance publishes metadata that
 * points at itself. Served from `app/.well-known/...` rather than `public/`
 * so `scopes_supported` can never drift from lib/agent/scopes.ts.
 */
export function GET(req: Request) {
  const origin = new URL(req.url).origin
  return Response.json({
    resource: origin,
    resource_name: 'answerLoops Agent API',
    scopes_supported: [...ALL_SCOPES],
    scope_descriptions: API_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/docs/integrations/agent-api`,
  })
}
