import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { ANSWER_REFERENCE_RETENTION_DAYS } from '@/lib/kb/coverage'
import { contentHash } from '@/lib/kb/revision'
import type {
  KBAnswerOutcome,
  KBAnswerRecord,
  KBAnswerReference,
  KBAnswerSurface,
  KBArticleAnswerRef,
} from '@/types'
import { getDb } from '../drizzle'
import { kbAnswerReferences, kbAnswers, kbArticles } from '../schema'

const SURFACES: readonly KBAnswerSurface[] = ['widget', 'ticket', 'discord', 'agent_api']
const OUTCOMES: readonly KBAnswerOutcome[] = ['generated', 'failed']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AnswerReferenceInput {
  articleId: number
  /** Position in the final context, lowest first. */
  rank: number
  /** Retrieval score, when the caller has one. */
  score?: number | null
}

export interface RecordAnswerInput {
  /** Supplied by the caller, so a retry or a repeated callback records the answer once. */
  answerId: string
  orgId: number
  surface: KBAnswerSurface
  outcome: KBAnswerOutcome
  references: AnswerReferenceInput[]
}

/**
 * Records that an answer was generated and which articles were supplied to it.
 * Facts only: no question or answer text, no visitor, no ticket content, and no
 * judgment about whether the reply used an article.
 *
 * The answer and its references are written in one transaction. Calling it again
 * with the same answer id changes nothing and returns `recorded: false`. An
 * article is looked up under `orgId`, so an id from another workspace is
 * skipped, and the revision hash is taken from the article as it is now, never
 * from the caller. Duplicate article ids count once (the best rank is kept), the
 * same way `recordArticleUsage` counts an answer once per article.
 */
export async function recordAnswerReferences(input: RecordAnswerInput): Promise<{ recorded: boolean }> {
  if (!UUID.test(input.answerId)) throw new Error('answerId must be a UUID')
  if (!SURFACES.includes(input.surface)) throw new Error(`unknown surface: ${input.surface}`)
  if (!OUTCOMES.includes(input.outcome)) throw new Error(`unknown outcome: ${input.outcome}`)

  // One entry per article, keeping the best (lowest) rank.
  const wanted = new Map<number, AnswerReferenceInput>()
  for (const ref of input.references) {
    if (!Number.isInteger(ref.articleId) || !Number.isInteger(ref.rank) || ref.rank < 0) continue
    const seen = wanted.get(ref.articleId)
    if (!seen || ref.rank < seen.rank) wanted.set(ref.articleId, ref)
  }

  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(kbAnswers)
      .values({ id: input.answerId, orgId: input.orgId, surface: input.surface, outcome: input.outcome })
      .onConflictDoNothing({ target: kbAnswers.id })
      .returning({ id: kbAnswers.id })
    if (inserted.length === 0) return { recorded: false }

    if (wanted.size > 0) {
      const articles = await tx
        .select({ id: kbArticles.id, question: kbArticles.question, answer: kbArticles.answer })
        .from(kbArticles)
        .where(and(eq(kbArticles.orgId, input.orgId), inArray(kbArticles.id, [...wanted.keys()])))
      const rows = articles.map((a) => {
        const ref = wanted.get(a.id)!
        return {
          answerId: input.answerId,
          articleId: a.id,
          articleContentHash: contentHash(a.question, a.answer),
          rank: ref.rank,
          score: ref.score ?? null,
        }
      })
      if (rows.length > 0) await tx.insert(kbAnswerReferences).values(rows)
    }
    return { recorded: true }
  })
}

/**
 * One answer and the articles supplied to it, lowest rank first. Null when the
 * answer does not exist in this workspace.
 */
export async function getReferencesForAnswer(answerId: string, orgId: number): Promise<KBAnswerRecord | null> {
  if (!UUID.test(answerId)) return null
  const db = getDb()
  const [answer] = await db
    .select()
    .from(kbAnswers)
    .where(and(eq(kbAnswers.id, answerId), eq(kbAnswers.orgId, orgId)))
    .limit(1)
  if (!answer) return null

  const rows = await db
    .select()
    .from(kbAnswerReferences)
    .where(eq(kbAnswerReferences.answerId, answerId))
    .orderBy(kbAnswerReferences.rank, kbAnswerReferences.id)
  const references: KBAnswerReference[] = rows.map((r) => ({
    article_id: r.articleId ?? null,
    article_content_hash: r.articleContentHash,
    rank: r.rank,
    score: r.score ?? null,
  }))
  return {
    id: answer.id,
    surface: answer.surface as KBAnswerSurface,
    outcome: answer.outcome as KBAnswerOutcome,
    created_at: answer.createdAt,
    references,
  }
}

/**
 * The most recent answers an article was supplied to, newest first. Scoped to
 * the workspace through the answer, so another workspace's answers never show.
 */
export async function getRecentAnswersForArticle(
  articleId: number,
  orgId: number,
  limit = 20
): Promise<KBArticleAnswerRef[]> {
  const n = Math.min(100, Math.max(1, Math.floor(limit)))
  const rows = await getDb()
    .select({
      answerId: kbAnswers.id,
      surface: kbAnswers.surface,
      outcome: kbAnswers.outcome,
      createdAt: kbAnswers.createdAt,
      rank: kbAnswerReferences.rank,
      score: kbAnswerReferences.score,
      hash: kbAnswerReferences.articleContentHash,
    })
    .from(kbAnswerReferences)
    .innerJoin(kbAnswers, eq(kbAnswers.id, kbAnswerReferences.answerId))
    .where(and(eq(kbAnswerReferences.articleId, articleId), eq(kbAnswers.orgId, orgId)))
    .orderBy(desc(kbAnswers.createdAt), desc(kbAnswerReferences.id))
    .limit(n)
  return rows.map((r) => ({
    answer_id: r.answerId,
    surface: r.surface as KBAnswerSurface,
    outcome: r.outcome as KBAnswerOutcome,
    created_at: r.createdAt,
    rank: r.rank,
    score: r.score ?? null,
    article_content_hash: r.hash,
  }))
}

/**
 * Deletes answers older than the retention window (their references go with
 * them) and returns how many answers were removed. Meant to run from a
 * periodic job.
 */
export async function pruneAnswerReferences(retentionDays: number = ANSWER_REFERENCE_RETENTION_DAYS): Promise<number> {
  const days = Math.floor(retentionDays)
  if (!Number.isFinite(days) || days < 1) throw new Error('retentionDays must be a positive integer')
  const rows = await getDb().execute(sql`
    DELETE FROM kb_answers
    WHERE created_at < now() - make_interval(days => ${days}::int)
    RETURNING 1
  `)
  return (rows as unknown as unknown[]).length
}
