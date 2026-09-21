import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'

export interface DeflectionStats {
  totalTickets: number
  answered: number
  deflected: number
}

export async function getDeflectionStats(orgId: number): Promise<DeflectionStats> {
  const db = getDb()

  // Bug reports are never KB-deflectable — the pipeline correctly declines to
  // auto-answer them, so they must not count against the deflection metric's
  // denominator. Excluded here rather than at the answered/deflected
  // sub-queries because bug tickets never get an ai_assessments row anyway
  // (runAIAgent skips assessAnswer/shouldAutoDeflect for that category).
  const [totRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM tickets
    WHERE org_id = ${orgId} AND status != 'duplicate' AND (category IS NULL OR category != 'bug')
  `)
  const [ansRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE t.org_id = ${orgId} AND t.status != 'duplicate' AND (t.category IS NULL OR t.category != 'bug')
  `)
  const [defRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE a.auto_deflected = 1 AND t.org_id = ${orgId} AND t.status != 'duplicate' AND (t.category IS NULL OR t.category != 'bug')
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
      AND (t.category IS NULL OR t.category != 'bug')
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
    ORDER BY a.confidence ASC NULLS LAST, t.created_at DESC
    LIMIT ${limit}
  `)
  return (rows as unknown as Array<KnowledgeGap & { has_kb_article: boolean | number }>).map((r) => ({
    ...r,
    has_kb_article: Boolean(r.has_kb_article),
    confidence: r.confidence != null ? Number(r.confidence) : null,
  }))
}

export interface GapCategorySummary {
  category: string
  count: number
  avg_confidence: number | null
}

export async function getGapCategorySummary(orgId: number): Promise<GapCategorySummary[]> {
  const rows = await getDb().execute(sql`
    SELECT
      COALESCE(t.category, 'uncategorized') AS category,
      COUNT(*)::int AS count,
      AVG(a.confidence) AS avg_confidence
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
    GROUP BY COALESCE(t.category, 'uncategorized')
    ORDER BY COUNT(*) DESC
  `)
  return rows as unknown as GapCategorySummary[]
}
