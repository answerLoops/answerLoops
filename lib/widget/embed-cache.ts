import { embedTextWithModel } from '@/lib/ai/embed'
import { getPinnedModel } from '@/lib/ai/embedding-pin'

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
 * tenant can never be handed another tenant's cache entry. It also carries
 * the org's pinned embedding model (lib/ai/embedding-pin.ts), so when the org
 * moves to a new model, vectors from the old one stop being served. Size and
 * age are both bounded so the map stays a fixed size however many distinct
 * queries arrive.
 */

const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 500

interface Entry {
  vector: number[]
  expiresAt: number
}

const cache = new Map<string, Entry>()

const keyFor = (orgId: number, model: string | null, query: string) =>
  `${orgId}:${model ?? ''}:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`

export async function embedQueryCached(query: string, orgId: number): Promise<number[]> {
  const pinned = await getPinnedModel(orgId)
  const hitKey = keyFor(orgId, pinned, query)
  const hit = cache.get(hitKey)
  if (hit && hit.expiresAt > Date.now()) {
    // Re-insert so the Map's insertion order doubles as recency order.
    cache.delete(hitKey)
    cache.set(hitKey, hit)
    return hit.vector
  }
  const { embedding: vector, model } = await embedTextWithModel(query, orgId)
  // Store under the key the next lookup will build. While the org has no pin
  // yet that is the null-pin key, so a repeat query hits instead of embedding
  // again; the entry is also stored under the model that produced it, so it
  // is found once the pin is set to that model.
  const keys = new Set([keyFor(orgId, pinned, query), keyFor(orgId, model, query)])
  for (const key of keys) {
    cache.delete(key)
    cache.set(key, { vector, expiresAt: Date.now() + TTL_MS })
  }
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
