import { eq, and, isNull, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { apiKeys } from '../schema'
import { generateApiKey, hashApiKey } from '@/lib/mcp/keys'
import { normalizeScopes, ALL_SCOPES, type ApiScope } from '@/lib/agent/scopes'

interface ApiKey {
  id: number
  org_id: number
  key_prefix: string
  name: string
  scopes: ApiScope[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

function toApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    org_id: row.orgId,
    key_prefix: row.keyPrefix,
    name: row.name,
    scopes: normalizeScopes(row.scopes),
    created_at: row.createdAt,
    last_used_at: row.lastUsedAt,
    expires_at: row.expiresAt,
    revoked_at: row.revokedAt,
  }
}

// Per-org ceiling on active (non-revoked) keys. There's no legitimate reason
// for one org to hold more, and without a cap a compromised session can mint
// unlimited long-lived credentials (each one an independent path into the
// org's data that survives the session ending).
const MAX_ACTIVE_KEYS_PER_ORG = 25

/**
 * Creates a key and returns the plaintext once — never retrievable again after this call.
 * expiresInDays is optional; omit (or pass undefined/null) for a key that never expires.
 * Throws if the org is already at MAX_ACTIVE_KEYS_PER_ORG active keys.
 */
export async function createApiKey(
  orgId: number,
  name: string,
  expiresInDays?: number | null,
  scopes?: readonly string[] | null
): Promise<{ plaintextKey: string; record: ApiKey }> {
  const [{ n: activeCount }] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)))
  if (Number(activeCount) >= MAX_ACTIVE_KEYS_PER_ORG) {
    throw new Error(`Active API key limit reached (${MAX_ACTIVE_KEYS_PER_ORG}). Revoke an unused key first.`)
  }

  const { key, hash, prefix } = generateApiKey()
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null
  // An explicit empty/all-invalid selection falls back to full access rather
  // than minting a key that can do nothing — normalizeScopes enforces that.
  const grantedScopes = scopes == null ? [...ALL_SCOPES] : normalizeScopes(scopes)
  const [row] = await getDb()
    .insert(apiKeys)
    .values({ orgId, keyHash: hash, keyPrefix: prefix, name, expiresAt, scopes: grantedScopes })
    .returning()
  return { plaintextKey: key, record: toApiKey(row) }
}

/**
 * Active keys only, newest first. Revoked records remain in the database for
 * auditability, but should not remain visible as usable workspace credentials.
 */
export async function listApiKeys(orgId: number): Promise<ApiKey[]> {
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)))
    .orderBy(apiKeys.createdAt)
  return rows.map(toApiKey).reverse()
}

/** Org-scoped so one org can never revoke another org's key by guessing an id (IDOR guard). */
export async function revokeApiKey(orgId: number, keyId: number): Promise<void> {
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId)))
}

/**
 * Resolves a presented Bearer key to its org, enforcing revocation/expiry,
 * and records last-used. Returns null for any invalid/inactive key — callers
 * must not distinguish "wrong key" from "revoked key" in the response (avoids
 * leaking key-validity as an oracle).
 */
export async function resolveApiKey(
  plaintextKey: string
): Promise<{ orgId: number; keyId: number; scopes: ApiScope[] } | null> {
  const hash = hashApiKey(plaintextKey)
  const [row] = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1)
  if (!row) return null
  if (row.expiresAt) {
    // Compared as instants, not strings: the column is text, so a stored value
    // in any ISO variant (offset, fractional seconds) must still order correctly.
    // An unparseable value fails closed.
    const expiresAtMs = new Date(row.expiresAt).getTime()
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null
  }

  await getDb().update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, row.id))
  return { orgId: row.orgId, keyId: row.id, scopes: normalizeScopes(row.scopes) }
}
