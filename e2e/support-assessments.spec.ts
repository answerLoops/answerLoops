import { randomUUID } from 'crypto'
import postgres from 'postgres'
import { test, expect } from '@playwright/test'
import { createArticle, deleteArticle } from '../lib/db/queries/kb'
import { recordAnswerReferences } from '../lib/db/queries/kb-answers'
import { hardPurgeOrg } from '../lib/db/queries/orgs'
import {
  getSupportCounts,
  getSupportFlags,
  getSupportForAnswer,
  getSupportSettings,
  recordSupportAssessment,
  recordSupportFlag,
  sweepSupportAssessments,
  updateSupportSettings,
  SupportFlagError,
  SupportSettingsError,
} from '../lib/db/queries/kb-support'
import { assessSupport, buildSnapshot, type SupportAssessment, type SupportSnapshot } from '../lib/kb/support'

// Source-support storage against a real Postgres: the idempotency key, the
// cascades, evidence that expires, flags that never touch findings, workspace
// isolation, and counts that reconcile. The mocks in tests/unit cannot prove
// any of this, because it is the database's own constraints doing the work.

const sql = postgres(process.env.DATABASE_URL!, { max: 2 })
test.afterAll(async () => {
  await sql.end()
})

const RESET = { question: 'Reset a password', answer: 'Open the sign-in page and choose Forgot password.\n\nLinks expire after 60 minutes.' }
const BILLING = { question: 'Invoices', answer: 'Invoices are sent monthly.' }
const ANSWER_TEXT = 'Choose Forgot password. The link expires after 60 minutes.'

// The suite's own seed inserts ids explicitly, so the sequences can be behind them.
async function advance(table: 'orgs' | 'users') {
  await sql`select setval(pg_get_serial_sequence(${table}, 'id'), greatest((select coalesce(max(id), 1) from ${sql(table)}), 1))`
}

async function newOrg(): Promise<number> {
  await advance('orgs')
  const slug = `support-${randomUUID().slice(0, 8)}`
  const [row] = await sql`insert into orgs (name, slug, onboarded_at) values (${slug}, ${slug}, now()::text) returning id`
  return row.id as number
}

async function newUser(): Promise<number> {
  await advance('users')
  const email = `support-${randomUUID().slice(0, 8)}@example.test`
  const [row] = await sql`insert into users (email, name, provider) values (${email}, 'Reviewer', 'test') returning id`
  return row.id as number
}

async function newArticle(orgId: number, content: { question: string; answer: string }) {
  const article = await createArticle({ ...content, embedding: Array.from({ length: 1536 }, () => 0.01), model: 'test-model' }, orgId)
  return { id: article.id, ...content }
}

/** An answer with references to the articles, as the answer path records it. */
async function newAnswer(orgId: number, articleIds: number[], outcome: 'generated' | 'failed' = 'generated', surface: 'ticket' | 'widget' = 'ticket') {
  const answerId = randomUUID()
  await recordAnswerReferences({
    answerId,
    orgId,
    surface,
    outcome,
    references: articleIds.map((articleId, i) => ({ articleId, rank: i + 1 })),
  })
  return answerId
}

const supportingJudge = (snapshot: SupportSnapshot) => ({
  findings: [
    { claim: 1, article: snapshot.articles[0].id, passage: 1, label: 'supports' },
    { claim: 2, article: snapshot.articles[0].id, passage: 2, label: 'supports' },
  ],
  off_topic: snapshot.articles.slice(1).map((a) => a.id),
})

async function assess(articles: Array<{ id: number; question: string; answer: string }>, answer = ANSWER_TEXT): Promise<SupportAssessment> {
  const snapshot = buildSnapshot({ question: 'How do I reset my password?', answer, articles })
  return assessSupport(snapshot, {
    judge: async () => ({ raw: supportingJudge(snapshot), modelId: 'fake-judge', usage: { inputTokens: 1500, outputTokens: 90 } }),
    embed: async (texts) => ({ embeddings: texts.map(() => [1, 0]), tokens: texts.length * 10 }),
  })
}

const count = async (table: string, where = sql`true`) =>
  Number((await sql`select count(*)::int as n from ${sql(table)} where ${where}`)[0].n)

/** An org with an answer that was assessed: supporting article A, off-topic article B. */
async function assessedAnswer(orgId: number) {
  const a = await newArticle(orgId, RESET)
  const b = await newArticle(orgId, BILLING)
  const answerId = await newAnswer(orgId, [a.id, b.id])
  const assessment = await assess([a, b])
  const result = await recordSupportAssessment({ orgId, answerId, assessment })
  expect(result.recorded).toBe(true)
  return { a, b, answerId, assessment, assessmentId: (result as { assessmentId: number }).assessmentId }
}

test.describe('recording and reading', () => {
  test('stores the run, one finding per assessed article, and a claim finding per tied claim, with no evidence text by default', async () => {
    const orgId = await newOrg()
    const { a, b, answerId } = await assessedAnswer(orgId)
    const record = (await getSupportForAnswer(answerId, orgId))!

    expect(record).toMatchObject({ execution: 'completed', answerSummary: 'supporting', judgeModel: 'fake-judge', methodVersion: 1, rubricVersion: 1 })
    expect(record.articles.map((x) => [x.articleId, x.summary, x.reasons])).toEqual([
      [a.id, 'supporting', []],
      [b.id, 'no_support', ['off_topic']],
    ])
    const claims = record.articles[0].claims
    expect(claims.map((c) => [c.claimIndex, c.label, c.passageIndex, c.evidence])).toEqual([
      [1, 'supports', 1, 'unavailable'],
      [2, 'supports', 2, 'unavailable'],
    ])
    expect(claims.every((c) => c.claimExcerpt === null && c.passageExcerpt === null)).toBe(true)
    expect(await count('kb_support_claim_findings', sql`claim_excerpt is not null or passage_excerpt is not null`)).toBe(0)
    // The hash is the revision that was supplied, copied from the reference row.
    expect(record.articles[0].articleContentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('recording the same answer and method again changes nothing', async () => {
    const orgId = await newOrg()
    const { answerId, assessment } = await assessedAnswer(orgId)
    const before = [await count('kb_support_assessments'), await count('kb_support_article_findings'), await count('kb_support_claim_findings')]
    const again = await recordSupportAssessment({ orgId, answerId, assessment })
    expect(again).toEqual({ recorded: false, reason: 'already_recorded' })
    expect([await count('kb_support_assessments'), await count('kb_support_article_findings'), await count('kb_support_claim_findings')]).toEqual(before)
  })

  test('a newer method version is a new row, and counts use one version at a time', async () => {
    const orgId = await newOrg()
    const { answerId, assessment } = await assessedAnswer(orgId)
    const v2: SupportAssessment = { ...assessment, method: { ...assessment.method, version: 2 } }
    expect((await recordSupportAssessment({ orgId, answerId, assessment: v2 })).recorded).toBe(true)
    expect(await count('kb_support_assessments', sql`answer_id = ${answerId}`)).toBe(2)

    const window = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) }
    const one = await getSupportCounts(orgId, window)
    const two = await getSupportCounts(orgId, { ...window, methodVersion: 2 })
    for (const c of [one, two]) {
      expect(c.pairs.supplied).toBe(2)
      expect(c.pairs.supporting + c.pairs.noSupport + c.pairs.inconclusive + c.pairs.notAssessed).toBe(2)
    }
    // Reading without a version gives the newest.
    expect((await getSupportForAnswer(answerId, orgId))!.methodVersion).toBe(2)
    expect((await getSupportForAnswer(answerId, orgId, { methodVersion: 1, rubricVersion: 1 }))!.methodVersion).toBe(1)
  })

  test('a failed or skipped run is stored with its reason and no findings, and reads as not assessed', async () => {
    const orgId = await newOrg()
    const a = await newArticle(orgId, RESET)
    const skippedAnswer = await newAnswer(orgId, [a.id])
    const skipped = await assessSupport(buildSnapshot({ question: 'q', answer: '', articles: [a] }), { judge: async () => ({}), embed: async () => ({ embeddings: [], tokens: 0 }) })
    expect(skipped.execution).toEqual({ state: 'skipped', reason: 'no_claims' })
    await recordSupportAssessment({ orgId, answerId: skippedAnswer, assessment: skipped })

    const failedAnswer = await newAnswer(orgId, [a.id])
    const failed = await assessSupport(buildSnapshot({ question: 'q', answer: ANSWER_TEXT, articles: [a] }), {
      judge: async () => {
        throw new Error('provider down')
      },
      embed: async () => ({ embeddings: [], tokens: 0 }),
    })
    await recordSupportAssessment({ orgId, answerId: failedAnswer, assessment: failed })

    expect(await getSupportForAnswer(skippedAnswer, orgId)).toMatchObject({ execution: 'skipped', skipReason: 'no_claims', failReason: null, answerSummary: 'not_assessed', articles: [] })
    expect(await getSupportForAnswer(failedAnswer, orgId)).toMatchObject({ execution: 'failed', failReason: 'provider_error', skipReason: null, answerSummary: 'not_assessed', articles: [] })
  })

  test('an answer given no articles is recorded as assessed with nothing to support it', async () => {
    const orgId = await newOrg()
    const answerId = await newAnswer(orgId, [])
    const assessment = await assess([])
    expect(assessment.answer).toBe('no_support')
    await recordSupportAssessment({ orgId, answerId, assessment })
    expect(await getSupportForAnswer(answerId, orgId)).toMatchObject({ execution: 'completed', answerSummary: 'no_support', articles: [] })
  })

  test('refuses an answer that is not in the workspace, was never generated, or a run that is not finished', async () => {
    const orgId = await newOrg()
    const other = await newOrg()
    const { answerId, assessment } = await assessedAnswer(orgId)
    expect(await recordSupportAssessment({ orgId: other, answerId, assessment })).toEqual({ recorded: false, reason: 'unknown_answer' })
    expect(await recordSupportAssessment({ orgId, answerId: randomUUID(), assessment })).toEqual({ recorded: false, reason: 'unknown_answer' })
    const failedGeneration = await newAnswer(orgId, [], 'failed')
    expect(await recordSupportAssessment({ orgId, answerId: failedGeneration, assessment })).toEqual({ recorded: false, reason: 'answer_not_generated' })
    const running: SupportAssessment = { ...assessment, execution: { state: 'running' } }
    expect(await recordSupportAssessment({ orgId, answerId: await newAnswer(orgId, []), assessment: running })).toEqual({ recorded: false, reason: 'not_final' })
    await expect(recordSupportAssessment({ orgId, answerId: 'not-a-uuid', assessment })).rejects.toThrow(/uuid/i)
  })
})

test.describe('evidence text', () => {
  test('is only stored when the workspace opted in, bounded, with an expiry inside the answer retention window', async () => {
    const orgId = await newOrg()
    await updateSupportSettings(orgId, { excerptStorageEnabled: true }, null)
    const { answerId } = await assessedAnswer(orgId)
    const record = (await getSupportForAnswer(answerId, orgId))!
    const [first] = record.articles[0].claims
    expect(first).toMatchObject({ evidence: 'available', claimExcerpt: 'Choose Forgot password.', passageExcerpt: 'Open the sign-in page and choose Forgot password.' })

    const [row] = await sql`
      select (c.evidence_expires_at - a.created_at) as window
      from kb_support_claim_findings c
      join kb_support_article_findings f on f.id = c.article_finding_id
      join kb_support_assessments s on s.id = f.assessment_id
      join kb_answers a on a.id = s.answer_id
      where a.id = ${answerId} limit 1`
    expect(String(row.window)).toMatch(/90 days|2160:00:00/)
  })

  test('turning the opt-in off removes every stored excerpt, keeps the findings, and they read as expired', async () => {
    const orgId = await newOrg()
    await updateSupportSettings(orgId, { excerptStorageEnabled: true }, null)
    const { answerId } = await assessedAnswer(orgId)
    const other = await newOrg()
    await updateSupportSettings(other, { excerptStorageEnabled: true }, null)
    const { answerId: otherAnswer } = await assessedAnswer(other)

    await updateSupportSettings(orgId, { excerptStorageEnabled: false }, null)
    const after = (await getSupportForAnswer(answerId, orgId))!
    expect(after.articles[0].claims.map((c) => [c.label, c.evidence, c.claimExcerpt])).toEqual([
      ['supports', 'expired', null],
      ['supports', 'expired', null],
    ])
    // Another workspace's text is untouched.
    expect((await getSupportForAnswer(otherAnswer, other))!.articles[0].claims[0].evidence).toBe('available')
  })

  test('expired text is never returned, even before the sweep removes it, and the sweep leaves the finding', async () => {
    const orgId = await newOrg()
    await updateSupportSettings(orgId, { excerptStorageEnabled: true }, null)
    const { answerId, assessmentId } = await assessedAnswer(orgId)
    await sql`
      update kb_support_claim_findings set evidence_expires_at = now() - interval '1 minute'
      where article_finding_id in (select id from kb_support_article_findings where assessment_id = ${assessmentId})`

    const before = (await getSupportForAnswer(answerId, orgId))!.articles[0].claims[0]
    expect(before).toMatchObject({ evidence: 'expired', claimExcerpt: null, passageExcerpt: null })
    expect(await count('kb_support_claim_findings', sql`claim_excerpt is not null`)).toBeGreaterThan(0)

    const swept = await sweepSupportAssessments()
    expect(swept.excerptsCleared).toBeGreaterThanOrEqual(2)
    expect(await count('kb_support_claim_findings', sql`evidence_expires_at < now() and (claim_excerpt is not null or passage_excerpt is not null)`)).toBe(0)
    expect((await getSupportForAnswer(answerId, orgId))!.articles[0].claims).toHaveLength(2)
  })

  test('the sweep leaves text that has not expired, in this workspace and every other', async () => {
    const orgId = await newOrg()
    await updateSupportSettings(orgId, { excerptStorageEnabled: true }, null)
    const fresh = await assessedAnswer(orgId)
    const expiring = await assessedAnswer(orgId)
    await sql`
      update kb_support_claim_findings set evidence_expires_at = now() - interval '1 second'
      where article_finding_id in (select id from kb_support_article_findings where assessment_id = ${expiring.assessmentId})`

    await sweepSupportAssessments()
    expect((await getSupportForAnswer(fresh.answerId, orgId))!.articles[0].claims.map((c) => c.evidence)).toEqual(['available', 'available'])
    expect((await getSupportForAnswer(expiring.answerId, orgId))!.articles[0].claims.map((c) => c.evidence)).toEqual(['expired', 'expired'])
  })

  test('the sweep removes assessments older than the retention window, with their findings and flags, and nothing newer', async () => {
    const orgId = await newOrg()
    const userId = await newUser()
    const old = await assessedAnswer(orgId)
    const recent = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${old.assessmentId} limit 1`
    await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'disagree' })
    await sql`update kb_support_assessments set assessed_at = now() - interval '91 days' where id = ${old.assessmentId}`

    const swept = await sweepSupportAssessments()
    expect(swept.assessmentsDeleted).toBeGreaterThanOrEqual(1)
    expect(await getSupportForAnswer(old.answerId, orgId)).toBeNull()
    expect(await count('kb_support_flags', sql`article_finding_id = ${finding.id}`)).toBe(0)
    expect(await getSupportForAnswer(recent.answerId, orgId)).not.toBeNull()
  })
})

test.describe('deleting things', () => {
  test('deleting an article keeps its finding, with a null article id and the stored hash, and a retry does not duplicate', async () => {
    const orgId = await newOrg()
    const { a, answerId, assessment } = await assessedAnswer(orgId)
    const hashBefore = (await getSupportForAnswer(answerId, orgId))!.articles[0].articleContentHash

    await deleteArticle(a.id, orgId)
    const after = (await getSupportForAnswer(answerId, orgId))!
    expect(after.articles[0]).toMatchObject({ articleId: null, articleContentHash: hashBefore, summary: 'supporting' })
    expect(after.articles[0].claims).toHaveLength(2)

    const again = await recordSupportAssessment({ orgId, answerId, assessment })
    expect(again).toEqual({ recorded: false, reason: 'already_recorded' })
    expect(await count('kb_support_assessments', sql`answer_id = ${answerId}`)).toBe(1)
    expect(await count('kb_support_article_findings', sql`assessment_id = ${after.assessmentId}`)).toBe(2)
  })

  test('deleting an answer removes its assessments, findings and flags', async () => {
    const orgId = await newOrg()
    const userId = await newUser()
    const { answerId, assessmentId } = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} limit 1`
    await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'agree' })

    await sql`delete from kb_answers where id = ${answerId}`
    expect(await count('kb_support_assessments', sql`id = ${assessmentId}`)).toBe(0)
    expect(await count('kb_support_article_findings', sql`assessment_id = ${assessmentId}`)).toBe(0)
    expect(await count('kb_support_flags', sql`article_finding_id = ${finding.id}`)).toBe(0)
  })

  test('purging the workspace removes the settings, assessments, findings and flags', async () => {
    const orgId = await newOrg()
    const userId = await newUser()
    await updateSupportSettings(orgId, { ticketEnabled: true, samplingRate: 0.5, dailyLimit: 10, excerptStorageEnabled: true }, userId)
    const { assessmentId } = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} limit 1`
    await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'agree' })

    await hardPurgeOrg(orgId)
    expect(await count('kb_support_settings', sql`org_id = ${orgId}`)).toBe(0)
    expect(await count('kb_support_assessments', sql`org_id = ${orgId}`)).toBe(0)
    expect(await count('kb_support_flags', sql`org_id = ${orgId}`)).toBe(0)
    expect(await count('kb_support_article_findings', sql`assessment_id = ${assessmentId}`)).toBe(0)
  })
})

test.describe('human flags', () => {
  test('a flag never changes the automated finding, and a person has one flag per target that they can change', async () => {
    const orgId = await newOrg()
    const userId = await newUser()
    const { assessmentId } = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} order by id limit 1`
    const automatedBefore = JSON.stringify([
      await sql`select * from kb_support_article_findings where assessment_id = ${assessmentId} order by id`,
      await sql`select * from kb_support_claim_findings where article_finding_id = ${finding.id} order by id`,
      await sql`select * from kb_support_assessments where id = ${assessmentId}`,
    ])

    const first = await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'disagree', note: '  Not what the article says.  ' })
    expect(first).toMatchObject({ verdict: 'disagree', note: 'Not what the article says.', userId })
    const changed = await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'agree' })
    expect(changed).toMatchObject({ id: first.id, verdict: 'agree', note: null })
    expect(await getSupportFlags(finding.id, orgId)).toHaveLength(1)

    const automatedAfter = JSON.stringify([
      await sql`select * from kb_support_article_findings where assessment_id = ${assessmentId} order by id`,
      await sql`select * from kb_support_claim_findings where article_finding_id = ${finding.id} order by id`,
      await sql`select * from kb_support_assessments where id = ${assessmentId}`,
    ])
    expect(automatedAfter).toBe(automatedBefore)
  })

  test('a claim flag is separate from the article flag, and the claim must belong to the finding', async () => {
    const orgId = await newOrg()
    const userId = await newUser()
    const { assessmentId } = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} order by id limit 1`
    const [otherFinding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} order by id desc limit 1`
    const [claim] = await sql`select id from kb_support_claim_findings where article_finding_id = ${finding.id} order by id limit 1`

    const article = await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'agree' })
    const onClaim = await recordSupportFlag({ orgId, userId, articleFindingId: finding.id, claimFindingId: claim.id, verdict: 'disagree' })
    expect(onClaim.id).not.toBe(article.id)
    expect(await getSupportFlags(finding.id, orgId)).toHaveLength(2)
    await expect(recordSupportFlag({ orgId, userId, articleFindingId: otherFinding.id, claimFindingId: claim.id, verdict: 'agree' })).rejects.toThrow(SupportFlagError)
  })

  test('refuses a bad verdict, an overlong note, and a finding from another workspace', async () => {
    const orgId = await newOrg()
    const other = await newOrg()
    const userId = await newUser()
    const { assessmentId } = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} limit 1`
    await expect(recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'maybe' as never })).rejects.toThrow(/agree or disagree/)
    await expect(recordSupportFlag({ orgId, userId, articleFindingId: finding.id, verdict: 'agree', note: 'x'.repeat(501) })).rejects.toThrow(/500/)
    await expect(recordSupportFlag({ orgId: other, userId, articleFindingId: finding.id, verdict: 'agree' })).rejects.toThrow(/not found/)
    expect(await getSupportFlags(finding.id, other)).toEqual([])
    expect(await count('kb_support_flags', sql`article_finding_id = ${finding.id}`)).toBe(0)
  })
})

test.describe('workspace isolation', () => {
  test('another workspace cannot read, count or reach a finding', async () => {
    const orgId = await newOrg()
    const other = await newOrg()
    const { answerId } = await assessedAnswer(orgId)
    expect(await getSupportForAnswer(answerId, other)).toBeNull()
    const window = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) }
    expect((await getSupportCounts(other, window)).pairs.supplied).toBe(0)
    expect((await getSupportCounts(orgId, window)).pairs.supplied).toBe(2)
  })
})

test.describe('counts', () => {
  test('reconcile over a mixed population: assessed, skipped, never assessed, no articles, failed generation', async () => {
    const orgId = await newOrg()
    const a = await newArticle(orgId, RESET)
    const b = await newArticle(orgId, BILLING)

    // Assessed: article a supporting, article b off topic (no support).
    const assessed = await newAnswer(orgId, [a.id, b.id])
    await recordSupportAssessment({ orgId, answerId: assessed, assessment: await assess([a, b]) })
    // Skipped: its two pairs are not assessed.
    const skipped = await newAnswer(orgId, [a.id, b.id])
    await recordSupportAssessment({
      orgId,
      answerId: skipped,
      assessment: await assessSupport(buildSnapshot({ question: 'q', answer: '', articles: [a, b] }), { judge: async () => ({}), embed: async () => ({ embeddings: [], tokens: 0 }) }),
    })
    // Never assessed: no row at all.
    await newAnswer(orgId, [a.id])
    // No articles, assessed: nothing to support it.
    const bare = await newAnswer(orgId, [])
    await recordSupportAssessment({ orgId, answerId: bare, assessment: await assess([]) })
    // A failed generation, with a reference: counted apart.
    await newAnswer(orgId, [a.id], 'failed')
    // Another channel, filtered out below.
    const widget = await newAnswer(orgId, [a.id], 'generated', 'widget')
    await recordSupportAssessment({ orgId, answerId: widget, assessment: await assess([a]) })

    const window = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) }
    const all = await getSupportCounts(orgId, window)
    // pairs: assessed (2) + skipped (2) + never (1) + widget (1) = 6 supplied; failed generation's 1 pair is apart.
    expect(all.pairs).toMatchObject({ supplied: 6, supporting: 2, noSupport: 1, inconclusive: 0, notAssessed: 3, completedAssessments: 3, failed: { pairs: 1 } })
    expect(all.pairs.supportRate).toEqual({ numerator: 2, denominator: 3 })
    // answers: assessed (supporting), skipped (not assessed), never (not assessed), bare (no support), widget (supporting).
    expect(all.answers).toMatchObject({ completed: 5, supporting: 2, noSupport: 1, inconclusive: 0, notAssessed: 2, failed: { answers: 1 } })

    const ticketsOnly = await getSupportCounts(orgId, { ...window, surfaces: ['ticket'] })
    expect(ticketsOnly.pairs.supplied).toBe(5)
    expect(ticketsOnly.answers.completed).toBe(4)

    const future = await getSupportCounts(orgId, { from: new Date(Date.now() + 3_600_000), to: new Date(Date.now() + 7_200_000) })
    expect(future.pairs.supplied).toBe(0)
  })
})

test.describe('settings', () => {
  test('a workspace that has changed nothing has everything off or unset', async () => {
    const orgId = await newOrg()
    expect(await getSupportSettings(orgId)).toEqual({
      widgetEnabled: false,
      ticketEnabled: false,
      discordEnabled: false,
      agentApiEnabled: false,
      samplingRate: null,
      dailyLimit: null,
      excerptStorageEnabled: false,
    })
    expect(await count('kb_support_settings', sql`org_id = ${orgId}`)).toBe(0)
  })

  test('changes only what it is given, remembers who changed it, and refuses values out of range', async () => {
    const orgId = await newOrg()
    const userId = await newUser()
    await updateSupportSettings(orgId, { ticketEnabled: true, samplingRate: 0.25 }, userId)
    const next = await updateSupportSettings(orgId, { dailyLimit: 40 }, userId)
    expect(next).toMatchObject({ ticketEnabled: true, widgetEnabled: false, samplingRate: 0.25, dailyLimit: 40, excerptStorageEnabled: false })
    expect(Number((await sql`select updated_by from kb_support_settings where org_id = ${orgId}`)[0].updated_by)).toBe(userId)

    await expect(updateSupportSettings(orgId, { samplingRate: 1.5 }, userId)).rejects.toThrow(SupportSettingsError)
    await expect(updateSupportSettings(orgId, { samplingRate: -0.1 }, userId)).rejects.toThrow(/between 0 and 1/)
    await expect(updateSupportSettings(orgId, { dailyLimit: -1 }, userId)).rejects.toThrow(/whole number/)
    await expect(updateSupportSettings(orgId, { dailyLimit: 2.5 }, userId)).rejects.toThrow(SupportSettingsError)
    await expect(updateSupportSettings(orgId, { widgetEnabled: 'yes' as never }, userId)).rejects.toThrow(/true or false/)
    expect(await getSupportSettings(orgId)).toMatchObject({ samplingRate: 0.25, dailyLimit: 40 })

    const cleared = await updateSupportSettings(orgId, { samplingRate: null, dailyLimit: null }, userId)
    expect(cleared).toMatchObject({ samplingRate: null, dailyLimit: null })
  })
})

test.describe('what the database itself refuses', () => {
  const insertAssessment = async (orgId: number, answerId: string, over: Record<string, unknown>) => {
    const row = { org_id: orgId, answer_id: answerId, method: 'm', method_version: 1, rubric_version: 1, execution_state: 'completed', answer_summary: 'supporting', ...over }
    return sql`insert into kb_support_assessments ${sql(row)}`
  }

  test('rejects a reason that does not match the state, an unknown state, and a conclusion from a run that did not complete', async () => {
    const orgId = await newOrg()
    const base = async () => newAnswer(orgId, [])
    await expect(insertAssessment(orgId, await base(), { skip_reason: 'disabled' })).rejects.toThrow(/reason_matches_state/)
    await expect(insertAssessment(orgId, await base(), { execution_state: 'failed', answer_summary: 'not_assessed' })).rejects.toThrow(/reason_matches_state/)
    await expect(insertAssessment(orgId, await base(), { execution_state: 'skipped', skip_reason: 'disabled', answer_summary: 'supporting' })).rejects.toThrow(/only_completed_concludes/)
    // An unknown state breaks several checks at once; the database reports whichever it checks first.
    await expect(insertAssessment(orgId, await base(), { execution_state: 'pending', answer_summary: 'not_assessed' })).rejects.toThrow(/violates check constraint/)
    await expect(insertAssessment(orgId, await base(), { execution_state: 'skipped', skip_reason: 'because', answer_summary: 'not_assessed' })).rejects.toThrow(/skip_reason_check/)
    await expect(insertAssessment(orgId, await base(), { answer_summary: 'used' })).rejects.toThrow(/summary_check/)
  })

  test('rejects evidence text with no expiry, text over the bound, a "none" label, a reason outside the set, and a repeated finding', async () => {
    const orgId = await newOrg()
    const { assessmentId } = await assessedAnswer(orgId)
    const [finding] = await sql`select id from kb_support_article_findings where assessment_id = ${assessmentId} order by id limit 1`
    const [ref] = await sql`select reference_id from kb_support_article_findings where id = ${finding.id}`
    const claim = (over: Record<string, unknown>) =>
      sql`insert into kb_support_claim_findings ${sql({ article_finding_id: finding.id, claim_index: 9, label: 'partial', passage_index: 1, ...over })}`

    await expect(claim({ claim_excerpt: 'text with no expiry' })).rejects.toThrow(/text_needs_expiry/)
    await expect(claim({ claim_excerpt: 'x'.repeat(301), evidence_expires_at: new Date(Date.now() + 1000) })).rejects.toThrow(/claim_excerpt_check/)
    await expect(claim({ label: 'none' })).rejects.toThrow(/label_check/)
    await expect(claim({ passage_index: 0 })).rejects.toThrow(/passage_check/)
    await expect(claim({ claim_index: 1 })).rejects.toThrow(/uq_kb_support_claim_findings_article_claim/)
    await expect(sql`update kb_support_article_findings set reasons = ${sql.array(['preferred'])} where id = ${finding.id}`).rejects.toThrow(/reasons_check/)
    await expect(
      sql`insert into kb_support_article_findings ${sql({ assessment_id: assessmentId, reference_id: ref.reference_id, article_content_hash: 'h', summary: 'supporting' })}`
    ).rejects.toThrow(/uq_kb_support_article_findings_assessment_reference/)
    await expect(
      sql`insert into kb_support_article_findings ${sql({ assessment_id: assessmentId, reference_id: ref.reference_id, article_content_hash: 'h', summary: 'not_assessed' })}`
    ).rejects.toThrow(/summary_check/)
  })

  test('rejects settings out of range', async () => {
    const orgId = await newOrg()
    await expect(sql`insert into kb_support_settings ${sql({ org_id: orgId, sampling_rate: 2 })}`).rejects.toThrow(/sampling_check/)
    await expect(sql`insert into kb_support_settings ${sql({ org_id: orgId, daily_limit: -5 })}`).rejects.toThrow(/daily_check/)
    await expect(sql`insert into kb_support_settings ${sql({ org_id: orgId, excerpt_storage_enabled: 2 })}`).rejects.toThrow(/excerpt_check/)
  })
})
