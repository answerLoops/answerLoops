import { embedText } from '@/lib/ai/embed'

/**
 * Short-lived cache of query embeddings for the widget.
 *
 * Embedding is a network round trip to the org's embedding provider that sits
 * on the critical path before the first token, and visitors ask the same
 * handful of questions over and over ("pricing?", "how do I reset my
 * password?"). Only the vector is cached — the knowledge-base search that
 * follows always runs fresh, so edits to articles show up immediately and
 * nothing a visitor could see is ever served stale.
 *
 * The key leads with the org id: each org can configure its own embedding
 * model, so a vector is only valid for the org that produced it, and one
 * tenant can never be handed another tenant's cache entry. Size and age are
 * both bounded so the map stays a fixed size however many distinct queries arrive.
 */

const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 500

interface Entry {
  vector: number[]
  expiresAt: number
}

const cache = new Map<string, Entry>()

const keyFor = (orgId: number, query: string) => `${orgId}:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`

export async function embedQueryCached(query: string, orgId: number): Promise<number[]> {
  const key = keyFor(orgId, query)
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) {
    // Re-insert so the Map's insertion order doubles as recency order.
    cache.delete(key)
    cache.set(key, hit)
    return hit.vector
  }
  const vector = await embedText(query, orgId)
  cache.delete(key)
  cache.set(key, { vector, expiresAt: Date.now() + TTL_MS })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return vector
}

/** Test hook. */
export function clearEmbedQueryCache(): void {
  cache.clear()
}
