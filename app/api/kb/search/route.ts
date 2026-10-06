import { requireOrgAccess } from '@/lib/auth/org'
import { embedText } from '@/lib/ai/embed'
import { searchArticles, textSearchArticles } from '@/lib/db/queries/kb'
import { rateLimit } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Matches the sibling kb routes (upload, sources) — every other mutation or
// listing route here 401s with no session rather than defaulting to org 1.
// This one didn't, which also meant the embedText call below ran unmetered
// for anyone, authenticated or not. See Known Issue 125.
const SEARCH_MAX = 60
const SEARCH_WINDOW_MS = 60_000

export async function GET(request: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  const limit = rateLimit(`kb-search:${orgId}`, SEARCH_MAX, SEARCH_WINDOW_MS)
  if (!limit.ok) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q) return Response.json([])

  try {
    const vector = await embedText(q, orgId)
    return Response.json({ results: await searchArticles(vector, 10, orgId), degraded: false })
  } catch (err) {
    logger.warn('vector search unavailable, falling back to text search', { module: 'api/kb/search', error: err })
    try {
      const results = await textSearchArticles(q, 10, orgId)
      return Response.json({ results, degraded: true })
    } catch (textErr) {
      logger.error('text search also failed', { module: 'api/kb/search', error: textErr })
      return Response.json({ error: 'Search failed' }, { status: 500 })
    }
  }
}
