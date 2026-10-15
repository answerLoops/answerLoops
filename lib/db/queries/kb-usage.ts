import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'

export interface ArticleUsage {
  article_id: number
  /** Answers this article was supplied to, all time. */
  total: number
  /** The same, over the last `windowDays` days (today included). */
  recent: number
}

// How many days the "recent" figure covers.
export const ARTICLE_USAGE_WINDOW_DAYS = 30

/**
 * Counts one answer for each of the given articles, on today's UTC row.
 *
 * The articles are looked up under `orgId` as part of the insert, so an id from
 * another workspace is skipped instead of being counted against it. Duplicate
 * ids count once: an answer is one use of an article however many of its
 * passages matched.
 */
export async function recordArticleUsage(orgId: number, articleIds: number[]): Promise<void> {
  const ids = [...new Set(articleIds.filter((id) => Number.isInteger(id)))]
  if (ids.length === 0) return

  await getDb().execute(sql`
    INSERT INTO kb_article_usage (article_id, org_id, day, answers)
    SELECT a.id, a.org_id, (now() AT TIME ZONE 'utc')::date, 1
    FROM kb_articles a
    WHERE a.org_id = ${orgId}
      AND a.id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::int[])
    ON CONFLICT (article_id, day) DO UPDATE SET answers = kb_article_usage.answers + 1
  `)
}

/**
 * Usage for every article in the workspace that has been used at least once.
 * Articles with no row never appear; callers treat a missing id as zero.
 */
export async function getArticleUsage(
  orgId: number,
  windowDays: number = ARTICLE_USAGE_WINDOW_DAYS
): Promise<ArticleUsage[]> {
  const rows = await getDb().execute(sql`
    SELECT
      article_id,
      SUM(answers)::int AS total,
      COALESCE(SUM(answers) FILTER (WHERE day > (now() AT TIME ZONE 'utc')::date - ${windowDays}::int), 0)::int AS recent
    FROM kb_article_usage
    WHERE org_id = ${orgId}
    GROUP BY article_id
    ORDER BY total DESC, article_id
  `)
  return (rows as unknown as ArticleUsage[]).map((r) => ({
    article_id: Number(r.article_id),
    total: Number(r.total),
    recent: Number(r.recent),
  }))
}
