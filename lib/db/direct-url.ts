/**
 * Connection string for LISTEN/NOTIFY, which needs a session-stable
 * connection — a pooled one (e.g. a provider's `-pooler` endpoint, PgBouncer in
 * transaction mode) can silently swap the physical backend between
 * statements, so a NOTIFY fired on a write never reaches a LISTEN
 * registered on a pooled connection. Every LISTEN consumer in this codebase
 * (bot/index.ts's config_changed reload, the member_joined SSE stream) must
 * use this instead of the pooled DATABASE_URL used for normal queries.
 *
 * Falls back to DATABASE_URL when DIRECT_DATABASE_URL isn't set, since a
 * self-hosted plain Postgres instance has no pooler distinction — its one
 * connection string already is a direct one. Only cloud/pooled deployments
 * (managed providers) need to actually set DIRECT_DATABASE_URL.
 */
export function getDirectDatabaseUrl(): string | undefined {
  return process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
}
