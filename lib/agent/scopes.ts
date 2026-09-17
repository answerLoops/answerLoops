/**
 * Machine-readable least-privilege scopes for the agent-facing surfaces
 * (the REST Agent API at /api/v1/agent/* and the MCP server at /api/mcp).
 *
 * Both surfaces authenticate with the same per-org Bearer key from
 * Settings → API Keys. Historically every key carried implicit full access;
 * a key now carries an explicit `scopes` array (api_keys.scopes) and each
 * operation declares the single scope it needs. A key created without an
 * explicit choice, and every key that predates this column, gets the full set
 * so the change is backward-compatible — the migration backfills existing
 * rows and createApiKey() defaults to it.
 *
 * These names are also what the OpenAPI security requirements and the
 * RFC 9728 protected-resource metadata (served at
 * /.well-known/oauth-protected-resource) advertise, so an agent can request
 * exactly the access it needs.
 */

export const API_SCOPES = {
  'kb:read': "Search the organization's knowledge base",
  'faq:read': 'Read the latest generated FAQ digest',
  'tickets:read': 'List support tickets',
  'tickets:write': 'Open support tickets on behalf of a user',
  'answers:write': 'Generate grounded answers (counts against the deflection limit)',
} as const

export type ApiScope = keyof typeof API_SCOPES

/** Every scope, in catalogue order. Also the default for a key created without an explicit choice. */
export const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[]

/** Read-only preset offered in the key-creation UI. */
export const READONLY_SCOPES: readonly ApiScope[] = ['kb:read', 'faq:read', 'tickets:read']

/**
 * The one scope each operation requires. Keyed by MCP tool name; the REST
 * routes reference the same entries so the two surfaces can never drift.
 */
export const TOOL_SCOPES = {
  search_kb: 'kb:read',
  get_faq: 'faq:read',
  get_tickets: 'tickets:read',
  create_ticket: 'tickets:write',
  generate_answer: 'answers:write',
} as const satisfies Record<string, ApiScope>

export function isApiScope(value: string): value is ApiScope {
  return value in API_SCOPES
}

/**
 * Normalises whatever is stored in api_keys.scopes (a Postgres text[])
 * to a validated, de-duplicated scope list. Unknown entries are dropped
 * rather than trusted. An empty/NULL result is treated as the full set by
 * resolveApiKey — a key must always be able to do *something*, and no path
 * writes an intentionally empty array.
 */
export function normalizeScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [...ALL_SCOPES]
  const seen = new Set<ApiScope>()
  for (const entry of raw) {
    if (typeof entry === 'string' && isApiScope(entry)) seen.add(entry)
  }
  return seen.size > 0 ? [...seen] : [...ALL_SCOPES]
}

export function hasScope(granted: readonly string[], required: ApiScope): boolean {
  return granted.includes(required)
}
