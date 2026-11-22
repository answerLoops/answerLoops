import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbAnswerReferences, kbAnswers, kbArticles, widgetAnswerFlags } from '../schema'

export type FlagVerdict = 'up' | 'down'
export type FlagReason = 'wrong_information' | 'outdated' | 'did_not_answer' | 'other'
export type FlagStatus = 'open' | 'resolved' | 'dismissed'

export const FLAG_REASONS: readonly FlagReason[] = ['wrong_information', 'outdated', 'did_not_answer', 'other']

// Most flags one workspace can collect in a UTC day. The widget is public, so
// this bounds what any one workspace's table can take in, however many
// visitors or addresses are used.
export const MAX_FLAGS_PER_DAY = 200

// The question, answer and note of a flag are cleared this long after it was
// made (a dismissed flag's at once). The row, reason and cited articles stay.
export const FLAG_TEXT_RETENTION_DAYS = 90

export interface AnswerFlag {
  id: number
  verdict: FlagVerdict
  reason: FlagReason | null
  note: string | null
  question: string
  answer: string
  cited_articles: { id: number; question: string }[]
  lead_id: number | null
  status: FlagStatus
  resolved_at: string | null
  created_at: string
}

export interface FlagCounts {
  open: number
  resolved: number
  dismissed: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CreateFlagOutcome =
  | { ok: true; id: number; created: boolean }
  | { ok: false; reason: 'no_answer' | 'limit' }

/**
 * Records a visitor's verdict on one widget answer.
 *
 * The answer must be a generated widget answer in this workspace; anything else
 * (another workspace's answer, a ticket draft, a failed generation) is refused
 * and writes nothing. The cited articles are taken from the answer's recorded
 * references, never from the caller. Question and answer text are stored for a
 * thumbs-down only, and must already be scrubbed and capped by the caller.
 *
 * One flag per answer: a second call for the same answer returns the existing
 * flag. A thumbs-up that is then changed to a thumbs-down becomes a thumbs-down
 * and gains the text; a flag a team member has already acted on is left alone.
 */
export async function createAnswerFlag(
  input: { orgId: number; answerId: string; verdict: FlagVerdict; question: string; answer: string },
  now: Date = new Date()
): Promise<CreateFlagOutcome> {
  if (!UUID.test(input.answerId)) return { ok: false, reason: 'no_answer' }
  const db = getDb()

  const [answer] = await db
    .select({ id: kbAnswers.id })
    .from(kbAnswers)
    .where(
      and(
        eq(kbAnswers.id, input.answerId),
        eq(kbAnswers.orgId, input.orgId),
        eq(kbAnswers.surface, 'widget'),
        eq(kbAnswers.outcome, 'generated')
      )
    )
    .limit(1)
  if (!answer) return { ok: false, reason: 'no_answer' }

  const [existing] = await db
    .select({ id: widgetAnswerFlags.id })
    .from(widgetAnswerFlags)
    .where(and(eq(widgetAnswerFlags.orgId, input.orgId), eq(widgetAnswerFlags.answerId, input.answerId)))
    .limit(1)

  if (!existing) {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
    const [today] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(widgetAnswerFlags)
      .where(and(eq(widgetAnswerFlags.orgId, input.orgId), sql`${widgetAnswerFlags.createdAt} >= ${dayStart}::timestamptz`))
    if ((today?.n ?? 0) >= MAX_FLAGS_PER_DAY) return { ok: false, reason: 'limit' }
  }

  const refs = await db
    .select({ articleId: kbAnswerReferences.articleId })
    .from(kbAnswerReferences)
    .where(eq(kbAnswerReferences.answerId, input.answerId))
    .orderBy(asc(kbAnswerReferences.rank), asc(kbAnswerReferences.id))
  const cited = refs.flatMap((r) => (r.articleId == null ? [] : [r.articleId]))

  const keepText = input.verdict === 'down'
  const stamp = now.toISOString()
  const inserted = await db
    .insert(widgetAnswerFlags)
    .values({
      orgId: input.orgId,
      answerId: input.answerId,
      verdict: input.verdict,
      question: keepText ? input.question : '',
      answer: keepText ? input.answer : '',
      citedArticleIds: cited,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoUpdate({
      target: widgetAnswerFlags.answerId,
      targetWhere: sql`${widgetAnswerFlags.answerId} IS NOT NULL`,
      // Only a still-open flag whose verdict actually changes is touched. Text
      // is added when the change is to a thumbs-down, and is never part of the
      // statement for a thumbs-up, so a repeat call cannot remove or add it
      // any other way.
      set: {
        verdict: input.verdict,
        updatedAt: stamp,
        ...(keepText && { question: input.question, answer: input.answer }),
      },
      setWhere: and(eq(widgetAnswerFlags.status, 'open'), sql`${widgetAnswerFlags.verdict} <> ${input.verdict}`),
    })
    .returning({ id: widgetAnswerFlags.id })
  if (inserted[0]) {
    return { ok: true, id: inserted[0].id, created: !existing }
  }
  // Nothing inserted or changed: the flag already existed as it should be.
  if (existing) return { ok: true, id: existing.id, created: false }
  // A concurrent call created it between the check and the insert.
  const [raced] = await db
    .select({ id: widgetAnswerFlags.id })
    .from(widgetAnswerFlags)
    .where(and(eq(widgetAnswerFlags.orgId, input.orgId), eq(widgetAnswerFlags.answerId, input.answerId)))
    .limit(1)
  return raced ? { ok: true, id: raced.id, created: false } : { ok: false, reason: 'no_answer' }
}

/** A thumbs-down flag in this workspace, with the question it was made on, or null. */
export async function getDownFlag(id: number, orgId: number): Promise<{ id: number; question: string } | null> {
  const [row] = await getDb()
    .select({ id: widgetAnswerFlags.id, question: widgetAnswerFlags.question })
    .from(widgetAnswerFlags)
    .where(and(eq(widgetAnswerFlags.id, id), eq(widgetAnswerFlags.orgId, orgId), eq(widgetAnswerFlags.verdict, 'down')))
    .limit(1)
  return row ?? null
}

/**
 * Adds the visitor's reason, note and/or the lead their email became to an
 * existing flag in this workspace. Only provided fields change. Returns false
 * when there is no such flag. Text must already be scrubbed and capped.
 */
export async function updateFlagDetails(
  input: { id: number; orgId: number; reason?: FlagReason; note?: string; leadId?: number },
  now: Date = new Date()
): Promise<boolean> {
  const set: Partial<typeof widgetAnswerFlags.$inferInsert> = { updatedAt: now.toISOString() }
  if (input.reason !== undefined) set.reason = input.reason
  if (input.note !== undefined) set.note = input.note
  if (input.leadId !== undefined) set.leadId = input.leadId
  const rows = await getDb()
    .update(widgetAnswerFlags)
    .set(set)
    .where(and(eq(widgetAnswerFlags.id, input.id), eq(widgetAnswerFlags.orgId, input.orgId)))
    .returning({ id: widgetAnswerFlags.id })
  return rows.length > 0
}

export async function countFlags(orgId: number): Promise<FlagCounts> {
  const rows = await getDb()
    .select({ status: widgetAnswerFlags.status, n: sql<number>`COUNT(*)::int` })
    .from(widgetAnswerFlags)
    .where(and(eq(widgetAnswerFlags.orgId, orgId), eq(widgetAnswerFlags.verdict, 'down')))
    .groupBy(widgetAnswerFlags.status)
  const counts: FlagCounts = { open: 0, resolved: 0, dismissed: 0 }
  for (const r of rows) {
    if (r.status === 'open' || r.status === 'resolved' || r.status === 'dismissed') counts[r.status] = r.n
  }
  return counts
}

export interface LeadFlag {
  flag_id: number
  lead_id: number
  reason: FlagReason | null
  /** The question and reply as flagged; empty once the retention window has cleared them. */
  question: string
  answer: string
}

/**
 * The thumbs-down flag each lead came from, for the workspace's Leads page. A
 * lead that was not left through a flag has none. Where one address flagged
 * several answers, the newest flag is the one shown.
 */
export async function listFlagsForLeads(orgId: number): Promise<Map<number, LeadFlag>> {
  const rows = await getDb()
    .select({
      id: widgetAnswerFlags.id,
      leadId: widgetAnswerFlags.leadId,
      reason: widgetAnswerFlags.reason,
      question: widgetAnswerFlags.question,
      answer: widgetAnswerFlags.answer,
    })
    .from(widgetAnswerFlags)
    .where(
      and(eq(widgetAnswerFlags.orgId, orgId), eq(widgetAnswerFlags.verdict, 'down'), sql`${widgetAnswerFlags.leadId} IS NOT NULL`)
    )
    // Oldest first, so a later row for the same lead replaces an earlier one below.
    .orderBy(asc(widgetAnswerFlags.createdAt), asc(widgetAnswerFlags.id))
  const byLead = new Map<number, LeadFlag>()
  for (const r of rows) {
    if (r.leadId == null) continue
    byLead.set(r.leadId, {
      flag_id: r.id,
      lead_id: r.leadId,
      reason: (r.reason as FlagReason | null) ?? null,
      question: r.question,
      answer: r.answer,
    })
  }
  return byLead
}

/** Thumbs-down flags in one status, newest first, with the articles each answer cited. */
export async function listFlags(orgId: number, status: FlagStatus, limit = 100): Promise<AnswerFlag[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(widgetAnswerFlags)
    .where(
      and(eq(widgetAnswerFlags.orgId, orgId), eq(widgetAnswerFlags.status, status), eq(widgetAnswerFlags.verdict, 'down'))
    )
    .orderBy(desc(widgetAnswerFlags.createdAt), desc(widgetAnswerFlags.id))
    .limit(limit)
  if (rows.length === 0) return []

  const ids = [...new Set(rows.flatMap((r) => r.citedArticleIds))]
  const titles = new Map<number, string>()
  if (ids.length > 0) {
    const articles = await db
      .select({ id: kbArticles.id, question: kbArticles.question })
      .from(kbArticles)
      .where(and(eq(kbArticles.orgId, orgId), inArray(kbArticles.id, ids)))
    for (const a of articles) titles.set(a.id, a.question)
  }

  return rows.map((r) => ({
    id: r.id,
    verdict: r.verdict as FlagVerdict,
    reason: (r.reason as FlagReason | null) ?? null,
    note: r.note,
    question: r.question,
    answer: r.answer,
    // An article deleted since the flag was made is simply left out.
    cited_articles: r.citedArticleIds.flatMap((id) => (titles.has(id) ? [{ id, question: titles.get(id)! }] : [])),
    lead_id: r.leadId ?? null,
    status: r.status as FlagStatus,
    resolved_at: r.resolvedAt ?? null,
    created_at: r.createdAt,
  }))
}

export type FlagResolution = { ok: true } | { ok: false; reason: 'not_found' | 'wrong_state' }

async function transition(
  id: number,
  orgId: number,
  from: FlagStatus[],
  to: FlagStatus,
  actorUserId: number
): Promise<FlagResolution> {
  const db = getDb()
  const now = new Date().toISOString()
  const set: Partial<typeof widgetAnswerFlags.$inferInsert> = {
    status: to,
    resolvedBy: to === 'open' ? null : actorUserId,
    resolvedAt: to === 'open' ? null : now,
    updatedAt: now,
  }
  // A dismissed flag is not worth keeping visitor text for.
  if (to === 'dismissed') Object.assign(set, { question: '', answer: '', note: null })
  const rows = await db
    .update(widgetAnswerFlags)
    .set(set)
    .where(and(eq(widgetAnswerFlags.id, id), eq(widgetAnswerFlags.orgId, orgId), inArray(widgetAnswerFlags.status, from)))
    .returning({ id: widgetAnswerFlags.id })
  if (rows.length > 0) return { ok: true }
  const [exists] = await db
    .select({ id: widgetAnswerFlags.id })
    .from(widgetAnswerFlags)
    .where(and(eq(widgetAnswerFlags.id, id), eq(widgetAnswerFlags.orgId, orgId)))
    .limit(1)
  return { ok: false, reason: exists ? 'wrong_state' : 'not_found' }
}

export const resolveFlag = (id: number, orgId: number, actorUserId: number) =>
  transition(id, orgId, ['open'], 'resolved', actorUserId)
export const dismissFlag = (id: number, orgId: number, actorUserId: number) =>
  transition(id, orgId, ['open', 'resolved'], 'dismissed', actorUserId)
export const reopenFlag = (id: number, orgId: number, actorUserId: number) =>
  transition(id, orgId, ['resolved', 'dismissed'], 'open', actorUserId)

/**
 * Clears the question, answer and note of flags made more than
 * FLAG_TEXT_RETENTION_DAYS ago and of dismissed flags, across every workspace.
 * Rows, reasons and cited articles stay. Idempotent. Returns how many rows were
 * cleared. Call it on a schedule (the bot's daily retention sweep does).
 */
export async function purgeExpiredFlagText(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - FLAG_TEXT_RETENTION_DAYS * 86_400_000).toISOString()
  const rows = await getDb()
    .update(widgetAnswerFlags)
    .set({ question: '', answer: '', note: null })
    .where(
      and(
        or(eq(widgetAnswerFlags.status, 'dismissed'), sql`${widgetAnswerFlags.createdAt} < ${cutoff}::timestamptz`),
        or(sql`${widgetAnswerFlags.question} <> ''`, sql`${widgetAnswerFlags.answer} <> ''`, sql`${widgetAnswerFlags.note} IS NOT NULL`)
      )
    )
    .returning({ id: widgetAnswerFlags.id })
  return rows.length
}
