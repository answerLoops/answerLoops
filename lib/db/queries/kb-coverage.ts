import { and, asc, eq, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles, kbSources } from '../schema'
import { buildCoverage, COVERAGE_MAX_ARTICLES, type Coverage } from '@/lib/kb/coverage'

/**
 * Every article an org has, with the facts retrieval depends on, grouped by
 * where it came from. Org-scoped on both tables: the source join repeats the
 * org condition so a source id can never pull in another org's filename.
 */
export async function getKnowledgeCoverage(orgId: number): Promise<Coverage> {
  const rows = await getDb()
    .select({
      id: kbArticles.id,
      title: kbArticles.question,
      published: kbArticles.published,
      searchable: sql<boolean>`${kbArticles.embeddingVec} IS NOT NULL`,
      sourceId: kbArticles.sourceId,
      sourceTicketId: kbArticles.sourceTicketId,
      sourceName: kbSources.filename,
      sourceType: kbSources.fileType,
    })
    .from(kbArticles)
    .leftJoin(kbSources, and(eq(kbSources.id, kbArticles.sourceId), eq(kbSources.orgId, orgId)))
    .where(eq(kbArticles.orgId, orgId))
    .orderBy(asc(kbArticles.id))
    // One extra row tells us whether there was more than we are willing to send.
    .limit(COVERAGE_MAX_ARTICLES + 1)

  const truncated = rows.length > COVERAGE_MAX_ARTICLES
  return buildCoverage(truncated ? rows.slice(0, COVERAGE_MAX_ARTICLES) : rows, truncated)
}
