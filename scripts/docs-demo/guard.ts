/**
 * Safety guard for the documentation demo seed.
 *
 * The seed writes (and re-writes) a whole fictional workspace, so it must never
 * be able to reach a shared or hosted database. This is a pure function so it
 * can be unit tested against hostile connection strings without a database.
 *
 * Allowed hosts, matched exactly after the URL has been parsed:
 *   - localhost, 127.0.0.1, [::1]
 *   - `postgres`, the default service name in a docker-compose network
 *
 * The check is made on the host the URL parser reports, never on a substring,
 * so `localhost.example.net`, `postgres://localhost@remote-host/db` (where
 * `localhost` is only the username) and similar tricks are refused.
 */

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres'])

// Query parameters that the postgres driver treats as connection overrides.
// Any of them can silently redirect the connection to another server even when
// the authority part of the URL looks local.
const HOST_OVERRIDE_PARAMS = ['host', 'hostaddr', 'hosts', 'service', 'servicefile', 'port']

export type DatabaseUrlCheck = { ok: true; host: string } | { ok: false; reason: string }

export function checkLocalDatabaseUrl(url: string | undefined | null): DatabaseUrlCheck {
  if (!url || !url.trim()) return { ok: false, reason: 'DATABASE_URL is not set' }

  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a valid URL' }
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { ok: false, reason: `unsupported protocol "${parsed.protocol}"` }
  }

  const host = parsed.hostname.toLowerCase()
  if (!ALLOWED_HOSTS.has(host)) {
    return {
      ok: false,
      reason: `host "${host || '(empty)'}" is not local (allowed: localhost, 127.0.0.1, [::1], postgres)`,
    }
  }

  for (const param of HOST_OVERRIDE_PARAMS) {
    if (parsed.searchParams.has(param)) {
      return { ok: false, reason: `query parameter "${param}" can override the connection target` }
    }
  }

  return { ok: true, host }
}

/** Throws unless every given connection string points at a local database. */
export function assertLocalDatabaseUrl(url: string | undefined | null, label = 'DATABASE_URL'): void {
  const result = checkLocalDatabaseUrl(url)
  if (!result.ok) {
    throw new Error(
      `Refusing to run the docs demo seed: ${label} check failed (${result.reason}). ` +
        'This script wipes and re-creates the demo workspace and may only run against a local throwaway database.'
    )
  }
}
