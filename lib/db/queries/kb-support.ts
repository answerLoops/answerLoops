import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import {
  kbAnswerReferences,
  kbAnswers,
  kbSupportArticleFindings,
  kbSupportAssessments,
  kbSupportClaimFindings,
  kbSupportFlags,
  kbSupportSettings,
} from '../schema'
import { ANSWER_REFERENCE_RETENTION_DAYS } from '@/lib/kb/coverage'
import {
  reconcileAnswerGroups,
  reconcilePairGroups,
  type AnswerReconciliation,
  type Group,
  type Reconciliation,
  type SupportAssessment,
  type SupportSummary,
} from '@/lib/kb/support'
import { SUPPORT_METHOD } from '@/lib/kb/support/method'
import type { KBAnswerSurface } from '@/types'

/**
 * Storage for source support (#437): the workspace's switches, the automated
 * findings, the human flags on them, the counts, and the sweep that removes
 * evidence text when it expires. Every query is scoped by workspace, and a row
 * from another workspace is never read, written or counted.
 *
 * Nothing here decides whether to assess anything; that is the runner's job.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MS_PER_DAY = 86_400_000

// --- settings ---------------------------------------------------------------

export interface SupportSettings {
  widgetEnabled: boolean
  ticketEnabled: boolean
  discordEnabled: boolean
  agentApiEnabled: boolean
  /** 0 to 1, or null when unset, which assesses nothing. */
  samplingRate: number | null
  /** Most assessments per day, or null when unset, which assesses nothing. */
  dailyLimit: number | null
  /** Whether bounded evidence text may be stored. Off by default. */
  excerptStorageEnabled: boolean
}

/** What a workspace that has never touched the switches has: everything off or unset. */
export const DEFAULT_SUPPORT_SETTINGS: Readonly<SupportSettings> = Object.freeze({
  widgetEnabled: false,
  ticketEnabled: false,
  discordEnabled: false,
  agentApiEnabled: false,
  samplingRate: null,
  dailyLimit: null,
  excerptStorageEnabled: false,
})

/** The most assessments per day a workspace may allow itself. */
export const MAX_DAILY_LIMIT = 100_000

export class SupportSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupportSettingsError'
  }
}

type SettingsRow = typeof kbSupportSettings.$inferSelect

function toSettings(row: SettingsRow | undefined): SupportSettings {
  if (!row) return { ...DEFAULT_SUPPORT_SETTINGS }
  return {
    widgetEnabled: row.widgetEnabled === 1,
    ticketEnabled: row.ticketEnabled === 1,
    discordEnabled: row.discordEnabled === 1,
    agentApiEnabled: row.agentApiEnabled === 1,
    samplingRate: row.samplingRate ?? null,
    dailyLimit: row.dailyLimit ?? null,
    excerptStorageEnabled: row.excerptStorageEnabled === 1,
  }
}

export async function getSupportSettings(orgId: number): Promise<SupportSettings> {
  const [row] = await getDb().select().from(kbSupportSettings).where(eq(kbSupportSettings.orgId, orgId)).limit(1)
  return toSettings(row)
}

/**
 * Changes only the switches named in `patch`. A value that is out of range is
 * refused, not clamped. Turning excerpt storage off also removes every stored
 * excerpt for the workspace, in the same transaction, and leaves the findings.
 */
export async function updateSupportSettings(
  orgId: number,
  patch: Partial<SupportSettings>,
  userId: number | null
): Promise<SupportSettings> {
  const set: Partial<typeof kbSupportSettings.$inferInsert> = {}
  const flag = (key: keyof SupportSettings, column: 'widgetEnabled' | 'ticketEnabled' | 'discordEnabled' | 'agentApiEnabled' | 'excerptStorageEnabled') => {
    const value = patch[key]
    if (value === undefined) return
    if (typeof value !== 'boolean') throw new SupportSettingsError(`${key} must be true or false`)
    set[column] = value ? 1 : 0
  }
  flag('widgetEnabled', 'widgetEnabled')
  flag('ticketEnabled', 'ticketEnabled')
  flag('discordEnabled', 'discordEnabled')
  flag('agentApiEnabled', 'agentApiEnabled')
  flag('excerptStorageEnabled', 'excerptStorageEnabled')

  if (patch.samplingRate !== undefined) {
    const rate = patch.samplingRate
    if (rate !== null && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1)) {
      throw new SupportSettingsError('The sampling rate must be between 0 and 1')
    }
    set.samplingRate = rate
  }
  if (patch.dailyLimit !== undefined) {
    const limit = patch.dailyLimit
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > MAX_DAILY_LIMIT)) {
      throw new SupportSettingsError(`The daily limit must be a whole number from 0 to ${MAX_DAILY_LIMIT}`)
    }
    set.dailyLimit = limit
  }
  if (Object.keys(set).length === 0) return getSupportSettings(orgId)

  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(kbSupportSettings)
      .values({ orgId, ...set, updatedBy: userId })
      .onConflictDoUpdate({
        target: kbSupportSettings.orgId,
        set: { ...set, updatedBy: userId, updatedAt: sql`now()` },
      })
      .returning()

    if (set.excerptStorageEnabled === 0) {
      // Remove the text, keep the findings, and stamp the expiry so they read as expired, not as never stored.
      await tx
        .update(kbSupportClaimFindings)
        .set({ claimExcerpt: null, passageExcerpt: null, evidenceExpiresAt: sql`now()` })
        .where(
          and(
            or(isNotNull(kbSupportClaimFindings.claimExcerpt), isNotNull(kbSupportClaimFindings.passageExcerpt)),
            inArray(
              kbSupportClaimFindings.articleFindingId,
              tx
                .select({ id: kbSupportArticleFindings.id })
                .from(kbSupportArticleFindings)
                .innerJoin(kbSupportAssessments, eq(kbSupportAssessments.id, kbSupportArticleFindings.assessmentId))
                .where(eq(kbSupportAssessments.orgId, orgId))
            )
          )
        )
    }
    return toSettings(row)
  })
}

// --- recording an assessment ------------------------------------------------

export type RecordAssessmentResult =
  | { recorded: true; assessmentId: number }
  | { recorded: false; reason: 'unknown_answer' | 'answer_not_generated' | 'already_recorded' | 'not_final' }

/**
 * Stores one finished assessment: how the run went, one finding per assessed
 * article, and one per claim the judge tied to a passage. Calling it again for
 * the same answer and method version changes nothing and reports
 * `already_recorded`, so a retry or a repeated callback never double-counts.
 *
 * Evidence text is written only when the workspace has turned excerpt storage
 * on (read here, so a caller cannot bypass it), is as bounded as the findings
 * already are, and expires with the answer's retention window. A pair with no
 * finding row is "not assessed". An answer from another workspace is refused.
 */
export async function recordSupportAssessment(input: {
  orgId: number
  answerId: string
  assessment: SupportAssessment
}): Promise<RecordAssessmentResult> {
  if (!UUID.test(input.answerId)) throw new Error('answerId must be a UUID')
  const { assessment } = input
  const state = assessment.execution.state
  if (state !== 'completed' && state !== 'failed' && state !== 'skipped') return { recorded: false, reason: 'not_final' }

  return getDb().transaction(async (tx) => {
    const [answer] = await tx
      .select({ createdAt: kbAnswers.createdAt, outcome: kbAnswers.outcome })
      .from(kbAnswers)
      .where(and(eq(kbAnswers.id, input.answerId), eq(kbAnswers.orgId, input.orgId)))
      .limit(1)
    if (!answer) return { recorded: false, reason: 'unknown_answer' }
    if (answer.outcome !== 'generated') return { recorded: false, reason: 'answer_not_generated' }

    const [inserted] = await tx
      .insert(kbSupportAssessments)
      .values({
        orgId: input.orgId,
        answerId: input.answerId,
        method: assessment.method.method,
        methodVersion: assessment.method.version,
        rubricVersion: assessment.method.rubric,
        executionState: state,
        skipReason: assessment.execution.state === 'skipped' ? assessment.execution.reason : null,
        failReason: assessment.execution.state === 'failed' ? assessment.execution.reason : null,
        answerSummary: assessment.answer,
        judgeModel: assessment.judgeModelId,
        similarityFloor: assessment.method.similarityFloor,
        judgeInputTokens: assessment.usage.judgeInputTokens,
        judgeOutputTokens: assessment.usage.judgeOutputTokens,
        embeddingTokens: assessment.usage.embeddingTokens,
      })
      .onConflictDoNothing({
        target: [kbSupportAssessments.answerId, kbSupportAssessments.methodVersion, kbSupportAssessments.rubricVersion],
      })
      .returning({ id: kbSupportAssessments.id })
    if (!inserted) return { recorded: false, reason: 'already_recorded' }
    if (state !== 'completed') return { recorded: true, assessmentId: inserted.id }

    const references = await tx
      .select({ id: kbAnswerReferences.id, articleId: kbAnswerReferences.articleId, hash: kbAnswerReferences.articleContentHash })
      .from(kbAnswerReferences)
      .where(eq(kbAnswerReferences.answerId, input.answerId))
    const byArticle = new Map(references.flatMap((r) => (r.articleId === null ? [] : [[r.articleId, r] as const])))

    // Only an article the answer actually has a reference row for can have a finding.
    const assessed = assessment.articles.filter((a) => a.summary !== 'not_assessed' && byArticle.has(a.articleId))
    if (assessed.length === 0) return { recorded: true, assessmentId: inserted.id }

    const articleRows = await tx
      .insert(kbSupportArticleFindings)
      .values(
        assessed.map((a) => ({
          assessmentId: inserted.id,
          referenceId: byArticle.get(a.articleId)!.id,
          articleContentHash: byArticle.get(a.articleId)!.hash,
          summary: a.summary,
          reasons: a.reasons,
          sharedWithReferenceIds: a.sharedWith.flatMap((id) => {
            const ref = byArticle.get(id)
            return ref ? [ref.id] : []
          }),
        }))
      )
      .returning({ id: kbSupportArticleFindings.id, referenceId: kbSupportArticleFindings.referenceId })
    const findingByReference = new Map(articleRows.map((r) => [r.referenceId, r.id]))

    const [settings] = await tx
      .select({ excerpts: kbSupportSettings.excerptStorageEnabled })
      .from(kbSupportSettings)
      .where(eq(kbSupportSettings.orgId, input.orgId))
      .limit(1)
    const storeExcerpts = settings?.excerpts === 1
    const expires = sql`${answer.createdAt}::timestamptz + make_interval(days => ${ANSWER_REFERENCE_RETENTION_DAYS}::int)`

    const claimRows = assessed.flatMap((a) =>
      a.findings.flatMap((f) =>
        f.label === 'none' || f.passage === null
          ? []
          : [
              {
                articleFindingId: findingByReference.get(byArticle.get(a.articleId)!.id)!,
                claimIndex: f.claim,
                label: f.label,
                passageIndex: f.passage,
                claimExcerpt: storeExcerpts ? f.claimQuote : null,
                passageExcerpt: storeExcerpts ? f.passageQuote : null,
                evidenceExpiresAt: storeExcerpts ? expires : null,
              },
            ]
      )
    )
    if (claimRows.length > 0) await tx.insert(kbSupportClaimFindings).values(claimRows)
    return { recorded: true, assessmentId: inserted.id }
  })
}

// --- reading ----------------------------------------------------------------

/** Whether a claim finding's evidence text can be shown. Expired text is never returned, even before the sweep removes it. */
export type EvidenceStatus = 'available' | 'unavailable' | 'expired'

export interface ClaimFinding {
  id: number
  claimIndex: number
  label: 'supports' | 'partial' | 'contradicts' | 'inconclusive'
  passageIndex: number
  claimExcerpt: string | null
  passageExcerpt: string | null
  evidence: EvidenceStatus
}

export interface ArticleFinding {
  id: number
  referenceId: number
  /** Null once the article has been deleted; the finding stays. */
  articleId: number | null
  articleContentHash: string
  summary: Exclude<SupportSummary, 'not_assessed'>
  reasons: string[]
  sharedWithReferenceIds: number[]
  claims: ClaimFinding[]
}

export interface SupportRecord {
  assessmentId: number
  answerId: string
  method: string
  methodVersion: number
  rubricVersion: number
  execution: 'completed' | 'failed' | 'skipped'
  skipReason: string | null
  failReason: string | null
  answerSummary: SupportSummary
  judgeModel: string | null
  assessedAt: string
  articles: ArticleFinding[]
}

function evidenceStatus(claim: string | null, passage: string | null, expiresAt: string | null, now: number): EvidenceStatus {
  const hasText = claim !== null || passage !== null
  if (hasText && expiresAt !== null && Date.parse(expiresAt) > now) return 'available'
  return expiresAt === null ? 'unavailable' : 'expired'
}

/**
 * What was found for one answer, for one method version (the newest when none
 * is given), or null when it has not been assessed under it. Scoped to the
 * workspace through the assessment.
 */
export async function getSupportForAnswer(
  answerId: string,
  orgId: number,
  version?: { methodVersion: number; rubricVersion: number }
): Promise<SupportRecord | null> {
  if (!UUID.test(answerId)) return null
  const db = getDb()
  const [assessment] = await db
    .select()
    .from(kbSupportAssessments)
    .where(
      and(
        eq(kbSupportAssessments.answerId, answerId),
        eq(kbSupportAssessments.orgId, orgId),
        ...(version
          ? [eq(kbSupportAssessments.methodVersion, version.methodVersion), eq(kbSupportAssessments.rubricVersion, version.rubricVersion)]
          : [])
      )
    )
    .orderBy(desc(kbSupportAssessments.methodVersion), desc(kbSupportAssessments.rubricVersion))
    .limit(1)
  if (!assessment) return null

  const articleRows = await db
    .select({
      id: kbSupportArticleFindings.id,
      referenceId: kbSupportArticleFindings.referenceId,
      articleId: kbAnswerReferences.articleId,
      hash: kbSupportArticleFindings.articleContentHash,
      summary: kbSupportArticleFindings.summary,
      reasons: kbSupportArticleFindings.reasons,
      shared: kbSupportArticleFindings.sharedWithReferenceIds,
    })
    .from(kbSupportArticleFindings)
    .innerJoin(kbAnswerReferences, eq(kbAnswerReferences.id, kbSupportArticleFindings.referenceId))
    .where(eq(kbSupportArticleFindings.assessmentId, assessment.id))
    .orderBy(kbAnswerReferences.rank, kbSupportArticleFindings.id)

  const claimRows =
    articleRows.length === 0
      ? []
      : await db
          .select()
          .from(kbSupportClaimFindings)
          .where(inArray(kbSupportClaimFindings.articleFindingId, articleRows.map((r) => r.id)))
          .orderBy(kbSupportClaimFindings.articleFindingId, kbSupportClaimFindings.claimIndex)

  const now = Date.now()
  return {
    assessmentId: assessment.id,
    answerId: assessment.answerId,
    method: assessment.method,
    methodVersion: assessment.methodVersion,
    rubricVersion: assessment.rubricVersion,
    execution: assessment.executionState as SupportRecord['execution'],
    skipReason: assessment.skipReason,
    failReason: assessment.failReason,
    answerSummary: assessment.answerSummary as SupportSummary,
    judgeModel: assessment.judgeModel,
    assessedAt: assessment.assessedAt,
    articles: articleRows.map((a) => ({
      id: a.id,
      referenceId: a.referenceId,
      articleId: a.articleId ?? null,
      articleContentHash: a.hash,
      summary: a.summary as ArticleFinding['summary'],
      reasons: a.reasons,
      sharedWithReferenceIds: a.shared,
      claims: claimRows
        .filter((c) => c.articleFindingId === a.id)
        .map((c) => {
          const evidence = evidenceStatus(c.claimExcerpt, c.passageExcerpt, c.evidenceExpiresAt, now)
          return {
            id: c.id,
            claimIndex: c.claimIndex,
            label: c.label as ClaimFinding['label'],
            passageIndex: c.passageIndex,
            claimExcerpt: evidence === 'available' ? c.claimExcerpt : null,
            passageExcerpt: evidence === 'available' ? c.passageExcerpt : null,
            evidence,
          }
        }),
    })),
  }
}

// --- counts -----------------------------------------------------------------

export interface SupportCountFilter {
  /** Answers created from this time (inclusive) up to `to` (exclusive). */
  from: Date
  to: Date
  surfaces?: readonly KBAnswerSurface[]
  /** One method version per population; the current one when omitted. Two versions are never mixed. */
  methodVersion?: number
  rubricVersion?: number
}

export interface SupportCounts {
  pairs: Reconciliation
  answers: AnswerReconciliation
}

/**
 * The buckets for a workspace over a time range and an optional set of
 * channels: supporting evidence found, no supporting evidence found,
 * inconclusive and not assessed, for the answer/article pairs and for the
 * answers. Every bucket comes from the same population (the supplied
 * articles), so they sum to the supplied total, which is also counted on its
 * own and checked: the call throws rather than return numbers that disagree.
 * A pair or an answer with no finding under the chosen version is not assessed.
 */
export async function getSupportCounts(orgId: number, filter: SupportCountFilter): Promise<SupportCounts> {
  const methodVersion = filter.methodVersion ?? SUPPORT_METHOD.version
  const rubricVersion = filter.rubricVersion ?? SUPPORT_METHOD.rubric
  const db = getDb()

  const inScope = and(
    eq(kbAnswers.orgId, orgId),
    gte(kbAnswers.createdAt, filter.from.toISOString()),
    lt(kbAnswers.createdAt, filter.to.toISOString()),
    ...(filter.surfaces && filter.surfaces.length > 0 ? [inArray(kbAnswers.surface, [...filter.surfaces])] : [])
  )
  const forVersion = and(
    eq(kbSupportAssessments.answerId, kbAnswers.id),
    eq(kbSupportAssessments.orgId, orgId),
    eq(kbSupportAssessments.methodVersion, methodVersion),
    eq(kbSupportAssessments.rubricVersion, rubricVersion)
  )

  const pairSummary = sql<string>`COALESCE(${kbSupportArticleFindings.summary}, 'not_assessed')`
  const [pairGroups, [pairTotal], answerGroups, [answerTotal]] = await Promise.all([
    db
      .select({ outcome: kbAnswers.outcome, summary: pairSummary, count: sql<number>`count(*)::int` })
      .from(kbAnswers)
      .innerJoin(kbAnswerReferences, eq(kbAnswerReferences.answerId, kbAnswers.id))
      .leftJoin(kbSupportAssessments, forVersion)
      .leftJoin(
        kbSupportArticleFindings,
        and(eq(kbSupportArticleFindings.assessmentId, kbSupportAssessments.id), eq(kbSupportArticleFindings.referenceId, kbAnswerReferences.id))
      )
      .where(inScope)
      .groupBy(kbAnswers.outcome, pairSummary),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(kbAnswers)
      .innerJoin(kbAnswerReferences, eq(kbAnswerReferences.answerId, kbAnswers.id))
      .where(and(inScope, eq(kbAnswers.outcome, 'generated'))),
    db
      .select({
        outcome: kbAnswers.outcome,
        summary: sql<string>`COALESCE(${kbSupportAssessments.answerSummary}, 'not_assessed')`,
        count: sql<number>`count(*)::int`,
      })
      .from(kbAnswers)
      .leftJoin(kbSupportAssessments, forVersion)
      .where(inScope)
      .groupBy(kbAnswers.outcome, sql`COALESCE(${kbSupportAssessments.answerSummary}, 'not_assessed')`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(kbAnswers)
      .where(and(inScope, eq(kbAnswers.outcome, 'generated'))),
  ])

  return {
    pairs: reconcilePairGroups(pairGroups as Group[], { expectedSupplied: pairTotal?.n ?? 0 }),
    answers: reconcileAnswerGroups(answerGroups as Group[], { expectedCompleted: answerTotal?.n ?? 0 }),
  }
}

// --- human flags ------------------------------------------------------------

export const FLAG_NOTE_MAX = 500
export const FLAG_VERDICTS = ['agree', 'disagree'] as const
export type FlagVerdict = (typeof FLAG_VERDICTS)[number]

export class SupportFlagError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupportFlagError'
  }
}

export interface SupportFlag {
  id: number
  articleFindingId: number
  claimFindingId: number | null
  userId: number | null
  verdict: FlagVerdict
  note: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Records that a person agrees or disagrees with an automated finding, on the
 * article's summary or on one claim. A person has one flag per target, which
 * they may change. It only ever writes the flags table: the automated finding
 * it is about is never edited, so provenance stays separate. A finding from
 * another workspace is refused.
 */
export async function recordSupportFlag(input: {
  orgId: number
  userId: number
  articleFindingId: number
  claimFindingId?: number | null
  verdict: FlagVerdict
  note?: string | null
}): Promise<SupportFlag> {
  if (!FLAG_VERDICTS.includes(input.verdict)) throw new SupportFlagError('The verdict must be agree or disagree')
  const note = input.note?.trim() ? input.note.trim() : null
  if (note !== null && note.length > FLAG_NOTE_MAX) throw new SupportFlagError(`Keep the note under ${FLAG_NOTE_MAX} characters`)
  const claimFindingId = input.claimFindingId ?? null

  return getDb().transaction(async (tx) => {
    const [finding] = await tx
      .select({ id: kbSupportArticleFindings.id })
      .from(kbSupportArticleFindings)
      .innerJoin(kbSupportAssessments, eq(kbSupportAssessments.id, kbSupportArticleFindings.assessmentId))
      .where(and(eq(kbSupportArticleFindings.id, input.articleFindingId), eq(kbSupportAssessments.orgId, input.orgId)))
      .limit(1)
    if (!finding) throw new SupportFlagError('That finding was not found')

    if (claimFindingId !== null) {
      const [claim] = await tx
        .select({ id: kbSupportClaimFindings.id })
        .from(kbSupportClaimFindings)
        .where(and(eq(kbSupportClaimFindings.id, claimFindingId), eq(kbSupportClaimFindings.articleFindingId, input.articleFindingId)))
        .limit(1)
      if (!claim) throw new SupportFlagError('That claim does not belong to this finding')
    }

    const values = {
      orgId: input.orgId,
      articleFindingId: input.articleFindingId,
      claimFindingId,
      userId: input.userId,
      verdict: input.verdict,
      note,
    }
    // One flag per person per target; the unique index differs by target, so the target names it.
    const [row] = await tx
      .insert(kbSupportFlags)
      .values(values)
      .onConflictDoUpdate({
        target: claimFindingId === null ? [kbSupportFlags.articleFindingId, kbSupportFlags.userId] : [kbSupportFlags.claimFindingId, kbSupportFlags.userId],
        targetWhere:
          claimFindingId === null
            ? sql`${kbSupportFlags.claimFindingId} IS NULL AND ${kbSupportFlags.userId} IS NOT NULL`
            : sql`${kbSupportFlags.claimFindingId} IS NOT NULL AND ${kbSupportFlags.userId} IS NOT NULL`,
        set: { verdict: input.verdict, note, updatedAt: sql`now()` },
      })
      .returning()
    return toFlag(row)
  })
}

function toFlag(row: typeof kbSupportFlags.$inferSelect): SupportFlag {
  return {
    id: row.id,
    articleFindingId: row.articleFindingId,
    claimFindingId: row.claimFindingId,
    userId: row.userId,
    verdict: row.verdict as FlagVerdict,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Every flag on one article finding (and its claims), newest first, within the workspace. */
export async function getSupportFlags(articleFindingId: number, orgId: number): Promise<SupportFlag[]> {
  const rows = await getDb()
    .select()
    .from(kbSupportFlags)
    .where(and(eq(kbSupportFlags.articleFindingId, articleFindingId), eq(kbSupportFlags.orgId, orgId)))
    .orderBy(desc(kbSupportFlags.updatedAt), desc(kbSupportFlags.id))
  return rows.map(toFlag)
}

// --- retention --------------------------------------------------------------

export interface SupportSweepResult {
  /** Claim findings whose evidence text was removed because it expired. */
  excerptsCleared: number
  /** Assessments removed for being past the retention window. */
  assessmentsDeleted: number
}

/**
 * Removes evidence text that has expired (the finding stays, and reads as
 * expired) and any assessment older than the retention window (its findings and
 * flags go with it). The window is the same one answers use, so there is no
 * second clock; assessments also go when their answer does. Meant to run before
 * the answer sweep, from the same periodic job.
 */
export async function sweepSupportAssessments(
  retentionDays: number = ANSWER_REFERENCE_RETENTION_DAYS,
  now: Date = new Date()
): Promise<SupportSweepResult> {
  const days = Math.floor(retentionDays)
  if (!Number.isFinite(days) || days < 1) throw new Error('retentionDays must be a positive integer')
  const db = getDb()
  const at = now.toISOString()
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString()

  const cleared = await db
    .update(kbSupportClaimFindings)
    .set({ claimExcerpt: null, passageExcerpt: null })
    .where(
      and(
        or(isNotNull(kbSupportClaimFindings.claimExcerpt), isNotNull(kbSupportClaimFindings.passageExcerpt)),
        sql`${kbSupportClaimFindings.evidenceExpiresAt} <= ${at}::timestamptz`
      )
    )
    .returning({ id: kbSupportClaimFindings.id })
  const deleted = await db
    .delete(kbSupportAssessments)
    .where(sql`${kbSupportAssessments.assessedAt} < ${cutoff}::timestamptz`)
    .returning({ id: kbSupportAssessments.id })
  return { excerptsCleared: cleared.length, assessmentsDeleted: deleted.length }
}
