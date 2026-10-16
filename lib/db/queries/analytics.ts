import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { clusterGaps, type GapCluster } from '@/lib/ai/gap-clusters'

export interface DeflectionStats {
  totalTickets: number
  answered: number
  deflected: number
}

export async function getDeflectionStats(orgId: number): Promise<DeflectionStats> {
  const db = getDb()

  // Bug reports and feature requests are routed to human review rather than
  // auto-deflected, so neither should count against the deflection metric.
  // Feature requests may have assessments, so keep the exclusion consistent
  // across the denominator and both assessed-ticket sub-queries.
  const [totRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM tickets
    WHERE org_id = ${orgId} AND status != 'duplicate' AND (category IS NULL OR category NOT IN ('bug', 'feature_request'))
  `)
  const [ansRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE t.org_id = ${orgId} AND t.status != 'duplicate' AND (t.category IS NULL OR t.category NOT IN ('bug', 'feature_request'))
  `)
  const [defRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE a.auto_deflected = 1 AND t.org_id = ${orgId} AND t.status != 'duplicate' AND (t.category IS NULL OR t.category NOT IN ('bug', 'feature_request'))
  `)

  return {
    totalTickets: Number((totRow as Record<string, unknown>).n ?? 0),
    answered: Number((ansRow as Record<string, unknown>).n ?? 0),
    deflected: Number((defRow as Record<string, unknown>).n ?? 0),
  }
}

export interface TrendPoint {
  day: string
  answered: number
  deflected: number
}

export async function getDeflectionTrend(days = 14, orgId: number): Promise<TrendPoint[]> {
  const rows = await getDb().execute(sql`
    SELECT LEFT(a.created_at, 10) AS day,
           COUNT(*)::int AS answered,
           SUM(a.auto_deflected)::int AS deflected
    FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE a.created_at >= (NOW() - (${days - 1} || ' days')::interval)::text
      AND t.org_id = ${orgId}
      AND t.status != 'duplicate'
      AND (t.category IS NULL OR t.category NOT IN ('bug', 'feature_request'))
    GROUP BY LEFT(a.created_at, 10)
    ORDER BY LEFT(a.created_at, 10)
  `)
  return rows as unknown as TrendPoint[]
}

export interface CategoryCount {
  category: string
  count: number
}

export async function getCategoryBreakdown(orgId: number): Promise<CategoryCount[]> {
  const rows = await getDb().execute(sql`
    SELECT COALESCE(category, 'uncategorized') AS category, COUNT(*)::int AS count
    FROM tickets
    WHERE org_id = ${orgId} AND status != 'duplicate'
    GROUP BY category
    ORDER BY COUNT(*) DESC
  `)
  return rows as unknown as CategoryCount[]
}

export interface DocGap {
  id: number
  org_ticket_number: number
  summary: string
  category: string | null
}

export async function getDocGaps(limit = 20, orgId: number): Promise<DocGap[]> {
  const rows = await getDb().execute(sql`
    SELECT t.id,
           t.org_ticket_number,
           COALESCE(t.ai_summary, LEFT(t.content, 120)) AS summary,
           t.category
    FROM tickets t
    LEFT JOIN kb_articles k ON k.source_ticket_id = t.id
    WHERE t.category IN ('documentation', 'how_to')
      AND t.status IN ('resolved', 'closed')
      AND k.id IS NULL
      AND t.org_id = ${orgId}
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `)
  return rows as unknown as DocGap[]
}

export interface SLAStats {
  responseMet: number
  responseBreached: number
  resolveMet: number
  resolveBreached: number
  avgFirstResponseMinutes: number | null
}

export async function getSLAStats(orgId: number): Promise<SLAStats> {
  const [row] = await getDb().execute(sql`
    SELECT
      SUM(CASE WHEN sla_response_met = 1 THEN 1 ELSE 0 END)::int AS "responseMet",
      SUM(CASE WHEN sla_response_met = 0 THEN 1 ELSE 0 END)::int AS "responseBreached",
      SUM(CASE WHEN sla_resolve_met = 1 THEN 1 ELSE 0 END)::int AS "resolveMet",
      SUM(CASE WHEN sla_resolve_met = 0 THEN 1 ELSE 0 END)::int AS "resolveBreached",
      AVG(
        CASE WHEN first_response_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (first_response_at::timestamp - created_at::timestamp)) / 60
        END
      ) AS "avgFirstResponseMinutes"
    FROM tickets
    WHERE org_id = ${orgId} AND status != 'duplicate'
  `)
  const r = row as Record<string, number | null>
  return {
    responseMet: r.responseMet ?? 0,
    responseBreached: r.responseBreached ?? 0,
    resolveMet: r.resolveMet ?? 0,
    resolveBreached: r.resolveBreached ?? 0,
    avgFirstResponseMinutes: r.avgFirstResponseMinutes,
  }
}

export interface KnowledgeGap {
  id: number
  org_ticket_number: number
  summary: string
  category: string | null
  confidence: number | null
  status: string
  created_at: string
  has_kb_article: boolean
  gap_reason: 'low_confidence' | 'needs_human' | 'no_kb_article'
}

export async function getKnowledgeGaps(limit = 50, orgId: number): Promise<KnowledgeGap[]> {
  const rows = await getDb().execute(sql`
    SELECT
      t.id,
      t.org_ticket_number,
      COALESCE(t.ai_summary, LEFT(t.content, 120)) AS summary,
      t.category,
      a.confidence,
      t.status,
      t.created_at,
      (k.id IS NOT NULL) AS has_kb_article,
      CASE
        WHEN t.ai_draft_status = 'needs_human' THEN 'needs_human'
        WHEN a.confidence IS NOT NULL AND a.confidence < 0.6 THEN 'low_confidence'
        ELSE 'no_kb_article'
      END AS gap_reason
    FROM tickets t
    LEFT JOIN ai_assessments a ON a.ticket_id = t.id
    LEFT JOIN kb_articles k ON k.source_ticket_id = t.id AND k.org_id = ${orgId}
    WHERE t.org_id = ${orgId}
      AND t.status != 'duplicate'
      AND k.id IS NULL
      AND (
        t.ai_draft_status = 'needs_human'
        OR (a.confidence IS NOT NULL AND a.confidence < 0.6 AND a.auto_deflected = 0)
        OR (t.status IN ('resolved', 'closed') AND t.category IN ('how_to', 'documentation'))
      )
    ORDER BY (t.ai_draft_status = 'needs_human') DESC, a.confidence ASC NULLS LAST, t.created_at DESC
    LIMIT ${limit}
  `)
  return (rows as unknown as Array<KnowledgeGap & { has_kb_article: boolean | number }>).map((r) => ({
    ...r,
    has_kb_article: Boolean(r.has_kb_article),
    confidence: r.confidence != null ? Number(r.confidence) : null,
  }))
}

// How many ranked gaps are pulled in to be clustered. Wider than the number of
// rows the page shows, so repeats of one question are found even when they are
// far apart in the ranking.
export const GAP_CLUSTER_POOL = 200

/**
 * Knowledge gaps with repeats of the same question folded into one entry,
 * most-asked first. The lead of each cluster is its highest-ranked ticket, so
 * the row still links to the ticket that most needs an article. Tickets whose
 * embedding is missing, or was made by a model the workspace has since moved
 * off, are never merged and appear on their own.
 */
export async function getKnowledgeGapClusters(limit = 50, orgId: number): Promise<GapCluster<KnowledgeGap>[]> {
  const gaps = await getKnowledgeGaps(GAP_CLUSTER_POOL, orgId)
  if (gaps.length === 0) return []

  const rows = await getDb().execute(sql`
    SELECT te.ticket_id, te.vector
    FROM ticket_embeddings te
    WHERE te.ticket_id IN (${sql.join(gaps.map((g) => sql`${g.id}`), sql`, `)})
      AND te.model = (SELECT embedding_model_in_use FROM orgs WHERE id = ${orgId})
  `)

  const vectors = new Map<number, number[]>()
  for (const r of rows as unknown as Array<{ ticket_id: number; vector: string }>) {
    try {
      const parsed: unknown = JSON.parse(r.vector)
      if (Array.isArray(parsed) && parsed.every((n) => Number.isFinite(n))) vectors.set(Number(r.ticket_id), parsed as number[])
    } catch {
      // A corrupt vector just leaves that ticket unmerged.
    }
  }

  return clusterGaps(gaps, vectors).slice(0, limit)
}

export interface GapCategorySummary {
  category: string
  /** Open gap tickets in the category. */
  count: number
  avg_confidence: number | null
}

export interface GapTicketTotals {
  /** Every open gap ticket, regardless of how many the list shows. */
  total: number
  needs_human: number
  low_confidence: number
  no_kb_article: number
  categories: GapCategorySummary[]
}

/**
 * Totals over ALL open gap tickets, computed in SQL so they do not depend on
 * how many tickets the grouped list pulls in. The summary cards and the
 * category breakdown are both derived from this one result, so they always
 * agree. The reason buckets use the same precedence as getKnowledgeGaps.
 */
export async function getGapTicketTotals(orgId: number): Promise<GapTicketTotals> {
  const rows = await getDb().execute(sql`
    SELECT
      COALESCE(t.category, 'uncategorized') AS category,
      CASE
        WHEN t.ai_draft_status = 'needs_human' THEN 'needs_human'
        WHEN a.confidence IS NOT NULL AND a.confidence < 0.6 THEN 'low_confidence'
        ELSE 'no_kb_article'
      END AS gap_reason,
      COUNT(*)::int AS count,
      COUNT(a.confidence)::int AS conf_n,
      COALESCE(SUM(a.confidence), 0) AS conf_sum
    FROM tickets t
    LEFT JOIN ai_assessments a ON a.ticket_id = t.id
    LEFT JOIN kb_articles k ON k.source_ticket_id = t.id AND k.org_id = ${orgId}
    WHERE t.org_id = ${orgId}
      AND t.status != 'duplicate'
      AND k.id IS NULL
      AND (
        t.ai_draft_status = 'needs_human'
        OR (a.confidence IS NOT NULL AND a.confidence < 0.6 AND a.auto_deflected = 0)
        OR (t.status IN ('resolved', 'closed') AND t.category IN ('how_to', 'documentation'))
      )
    GROUP BY 1, 2
  `)

  const totals: GapTicketTotals = { total: 0, needs_human: 0, low_confidence: 0, no_kb_article: 0, categories: [] }
  const byCategory = new Map<string, { count: number; confSum: number; confN: number }>()
  for (const r of rows as unknown as Array<{
    category: string
    gap_reason: 'needs_human' | 'low_confidence' | 'no_kb_article'
    count: number | string
    conf_n: number | string
    conf_sum: number | string
  }>) {
    const count = Number(r.count)
    totals.total += count
    if (r.gap_reason in totals) totals[r.gap_reason] += count
    const entry = byCategory.get(r.category) ?? { count: 0, confSum: 0, confN: 0 }
    entry.count += count
    entry.confSum += Number(r.conf_sum)
    entry.confN += Number(r.conf_n)
    byCategory.set(r.category, entry)
  }
  totals.categories = [...byCategory.entries()]
    .map(([category, e]) => ({
      category,
      count: e.count,
      avg_confidence: e.confN > 0 ? e.confSum / e.confN : null,
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
  return totals
}

export async function getGapCategorySummary(orgId: number): Promise<GapCategorySummary[]> {
  return (await getGapTicketTotals(orgId)).categories
}
