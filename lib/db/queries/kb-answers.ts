import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { ANSWER_REFERENCE_RETENTION_DAYS } from '@/lib/kb/coverage'
import { contentHash } from '@/lib/kb/revision'
import { collapseExactSources, sourceStatus } from '@/lib/kb/answer-sources'
import type {
  KBAnswerOutcome,
  KBAnswerRecord,
  KBAnswerReference,
  KBAnswerSource,
  KBAnswerSurface,
  KBArticleAnswerRef,
  KBArticleAnswerView,
  KBTicketAnswerSources,
} from '@/types'
import { getDb } from '../drizzle'
import { kbAnswerReferences, kbAnswers, kbArticles, tickets } from '../schema'

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
  /**
   * The ticket this answer was drafted for. Only kept for the ticket surface,
   * and only when the ticket belongs to the workspace; otherwise ignored. An
   * opaque id: nothing from the ticket is stored.
   */
  ticketId?: number | null
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
    let ticketId: number | null = null
    if (input.surface === 'ticket' && input.ticketId != null && Number.isInteger(input.ticketId)) {
      const [ticket] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.id, input.ticketId), eq(tickets.orgId, input.orgId)))
        .limit(1)
      ticketId = ticket?.id ?? null
    }

    const inserted = await tx
      .insert(kbAnswers)
      .values({ id: input.answerId, orgId: input.orgId, surface: input.surface, outcome: input.outcome, ticketId })
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
 * The sources behind a ticket's most recent draft, lowest rank first, each with
 * where it stands now: current, changed since, unpublished or deleted. Null
 * when the ticket has no recorded answer (older tickets, tickets that were
 * never drafted from the knowledge base, or one past the retention window).
 *
 * Scoped to the workspace through the answer and through the article join, so
 * another workspace's answer or article never appears. Only the article's own
 * title is returned, never text from the conversation.
 */
export async function getAnswerSourcesForTicket(ticketId: number, orgId: number): Promise<KBTicketAnswerSources | null> {
  const db = getDb()
  const [answer] = await db
    .select()
    .from(kbAnswers)
    .where(and(eq(kbAnswers.ticketId, ticketId), eq(kbAnswers.orgId, orgId)))
    .orderBy(desc(kbAnswers.createdAt))
    .limit(1)
  if (!answer) return null

  const rows = await db
    .select({
      articleId: kbAnswerReferences.articleId,
      hash: kbAnswerReferences.articleContentHash,
      rank: kbAnswerReferences.rank,
      question: kbArticles.question,
      answer: kbArticles.answer,
      published: kbArticles.published,
    })
    .from(kbAnswerReferences)
    .leftJoin(kbArticles, and(eq(kbArticles.id, kbAnswerReferences.articleId), eq(kbArticles.orgId, orgId)))
    .where(eq(kbAnswerReferences.answerId, answer.id))
    .orderBy(kbAnswerReferences.rank, kbAnswerReferences.id)

  // Exact copies are shown once, so the same source is never listed or linked twice.
  const sources: KBAnswerSource[] = collapseExactSources(
    rows.map((r) => {
      const live = r.question === null || r.answer === null || r.published === null
        ? null
        : { question: r.question, answer: r.answer, published: r.published }
      return {
        source: {
          article_id: live ? r.articleId : null,
          title: live ? live.question : null,
          rank: r.rank,
          status: sourceStatus(r.hash, live),
        },
        recordedHash: r.hash,
        currentHash: live ? contentHash(live.question, live.answer) : null,
      }
    })
  )
  return {
    answer_id: answer.id,
    outcome: answer.outcome as KBAnswerOutcome,
    created_at: answer.createdAt,
    sources,
  }
}

/**
 * The recent answers an article was supplied to, newest first, each marked
 * `earlier` when the article has been edited since that answer. Null when the
 * article is not in the workspace, so a caller can tell that from an empty list.
 */
export async function getArticleAnswerView(
  articleId: number,
  orgId: number,
  limit = 20
): Promise<KBArticleAnswerView[] | null> {
  const [article] = await getDb()
    .select({ question: kbArticles.question, answer: kbArticles.answer })
    .from(kbArticles)
    .where(and(eq(kbArticles.id, articleId), eq(kbArticles.orgId, orgId)))
    .limit(1)
  if (!article) return null

  const now = contentHash(article.question, article.answer)
  const answers = await getRecentAnswersForArticle(articleId, orgId, limit)
  return answers.map((a) => ({ ...a, revision: a.article_content_hash === now ? 'current' : 'earlier' }))
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
