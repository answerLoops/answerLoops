// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import {
  kbSupportAssessments,
  kbSupportClaimFindings,
  kbSupportFlags,
  kbSupportSettings,
} from '@/lib/db/schema'
import { assessSupport, buildSnapshot, type SupportAssessment } from '@/lib/kb/support'

/**
 * The guards and the SQL shapes of the source-support queries, compiled by
 * drizzle's pg-proxy driver with scripted rows and no database. What the
 * constraints and cascades actually do is checked against a real Postgres in
 * e2e/support-assessments.spec.ts.
 */

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let respond: (c: Call) => unknown[][]

const ANSWER = '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44'

beforeEach(() => {
  calls = []
  respond = () => []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    return { rows: respond(call) }
  })
  const db = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ sql: 'begin', params: [] })
      const out = await fn(fakeDb)
      calls.push({ sql: 'commit', params: [] })
      return out
    },
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
})

const queries = () => import('@/lib/db/queries/kb-support')
const writes = () => calls.filter((c) => /^(insert|update|delete)/.test(c.sql))
const rowOf = (table: Parameters<typeof getTableColumns>[0], values: Record<string, unknown>) =>
  Object.values(getTableColumns(table)).map((col) => (col.name in values ? values[col.name] : null))

async function completedAssessment(): Promise<SupportAssessment> {
  const articles = [
    { id: 10, question: 'Reset', answer: 'Open the sign-in page and choose Forgot password.\n\nLinks expire after 60 minutes.' },
    { id: 20, question: 'Billing', answer: 'Invoices are sent monthly.' },
  ]
  const snapshot = buildSnapshot({ question: 'q', answer: 'Choose Forgot password. The link expires after 60 minutes.', articles })
  return assessSupport(snapshot, {
    judge: async () => ({
      raw: {
        findings: [
          { claim: 1, article: 10, passage: 1, label: 'supports' },
          { claim: 2, article: 10, passage: 2, label: 'supports' },
        ],
        off_topic: [20],
      },
      modelId: 'fake',
    }),
    embed: async (t) => ({ embeddings: t.map(() => [1, 0]), tokens: 1 }),
  })
}

/** Scripted rows for a full successful recording. */
function scriptRecording(excerpts: boolean, references = [{ id: 7, article: 10 }, { id: 8, article: 20 }]) {
  respond = (c) => {
    if (c.sql.startsWith('select') && c.sql.includes('from "kb_answers"')) return [['2026-10-25T10:00:00+00:00', 'generated']]
    if (c.sql.startsWith('insert into "kb_support_assessments"')) return [[41]]
    if (c.sql.startsWith('select') && c.sql.includes('from "kb_answer_references"')) return references.map((r) => [r.id, r.article, `hash-${r.article}`])
    if (c.sql.startsWith('insert into "kb_support_article_findings"')) return references.map((r, i) => [100 + i, r.id])
    if (c.sql.startsWith('select') && c.sql.includes('from "kb_support_settings"')) return [[excerpts ? 1 : 0]]
    return []
  }
}

describe('settings', () => {
  it.each([
    [{ samplingRate: 1.1 }, /between 0 and 1/],
    [{ samplingRate: -0.01 }, /between 0 and 1/],
    [{ samplingRate: Number.NaN }, /between 0 and 1/],
    [{ samplingRate: '0.5' as never }, /between 0 and 1/],
    [{ dailyLimit: -1 }, /whole number/],
    [{ dailyLimit: 1.5 }, /whole number/],
    [{ dailyLimit: 100_001 }, /whole number/],
    [{ widgetEnabled: 'yes' as never }, /true or false/],
    [{ ticketEnabled: 1 as never }, /true or false/],
    [{ excerptStorageEnabled: null as never }, /true or false/],
  ])('refuses %j before touching the database', async (patch, message) => {
    const { updateSupportSettings, SupportSettingsError } = await queries()
    await expect(updateSupportSettings(3, patch, 1)).rejects.toThrow(message)
    await expect(updateSupportSettings(3, patch, 1)).rejects.toBeInstanceOf(SupportSettingsError)
    expect(calls).toHaveLength(0)
  })

  it('an empty change reads once and writes nothing', async () => {
    const { updateSupportSettings } = await queries()
    await updateSupportSettings(3, {}, 1)
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toMatch(/^select/)
    expect(writes()).toHaveLength(0)
  })

  it('upserts only the switches it was given, in one transaction, recording who and when', async () => {
    respond = (c) => (c.sql.startsWith('insert') ? [rowOf(kbSupportSettings, { org_id: 3, ticket_enabled: 1, updated_by: 9 })] : [])
    const { updateSupportSettings } = await queries()
    const out = await updateSupportSettings(3, { ticketEnabled: true }, 9)
    expect(out.ticketEnabled).toBe(true)
    const insert = calls.find((c) => c.sql.startsWith('insert into "kb_support_settings"'))!
    expect(insert.sql).toContain('on conflict ("org_id") do update set')
    expect(insert.sql).toContain('"ticket_enabled" = $')
    expect(insert.sql).not.toContain('"widget_enabled" = $')
    expect(insert.sql).toContain('"updated_at" = now()')
    expect(insert.params).toEqual(expect.arrayContaining([3, 1, 9]))
    expect(calls[0].sql).toBe('begin')
    expect(calls.at(-1)!.sql).toBe('commit')
  })

  it('turning excerpt storage off also removes the stored text for this workspace only, in the same transaction', async () => {
    respond = (c) => (c.sql.startsWith('insert') ? [rowOf(kbSupportSettings, { org_id: 3 })] : [])
    const { updateSupportSettings } = await queries()
    await updateSupportSettings(3, { excerptStorageEnabled: false }, 9)
    const clear = calls.find((c) => c.sql.startsWith('update "kb_support_claim_findings"'))!
    expect(clear.sql).toContain('"claim_excerpt" = $')
    expect(clear.sql).toContain('"evidence_expires_at" = now()')
    expect(clear.sql).toMatch(/"org_id" = \$/)
    expect(clear.params).toContain(3)
    expect(calls.indexOf(clear)).toBeLessThan(calls.findIndex((c) => c.sql === 'commit'))
  })

  it.each([[{ excerptStorageEnabled: true }], [{ ticketEnabled: false }], [{ samplingRate: 0.5 }], [{ dailyLimit: null }]])(
    'does not touch stored text when the change is %j',
    async (patch) => {
      respond = (c) => (c.sql.startsWith('insert') ? [rowOf(kbSupportSettings, { org_id: 3 })] : [])
      const { updateSupportSettings } = await queries()
      await updateSupportSettings(3, patch, 9)
      expect(calls.some((c) => c.sql.startsWith('update "kb_support_claim_findings"'))).toBe(false)
    }
  )

  it('a workspace with no row has everything off, and the defaults object cannot be changed through a result', async () => {
    const { getSupportSettings, DEFAULT_SUPPORT_SETTINGS } = await queries()
    const settings = await getSupportSettings(3)
    expect(settings).toEqual(DEFAULT_SUPPORT_SETTINGS)
    settings.widgetEnabled = true
    expect(DEFAULT_SUPPORT_SETTINGS.widgetEnabled).toBe(false)
    expect(Object.isFrozen(DEFAULT_SUPPORT_SETTINGS)).toBe(true)
  })
})

describe('recordSupportAssessment', () => {
  it('refuses an answer id that is not a UUID, and a run that is not finished, without a query', async () => {
    const { recordSupportAssessment } = await queries()
    const assessment = await completedAssessment()
    await expect(recordSupportAssessment({ orgId: 3, answerId: `${ANSWER}; drop table kb_answers`, assessment })).rejects.toThrow(/uuid/i)
    expect(await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: { ...assessment, execution: { state: 'pending' } } })).toEqual({ recorded: false, reason: 'not_final' })
    expect(await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: { ...assessment, execution: { state: 'running' } } })).toEqual({ recorded: false, reason: 'not_final' })
    expect(calls).toHaveLength(0)
  })

  it('looks the answer up within the workspace, and writes nothing for an unknown or ungenerated one', async () => {
    const { recordSupportAssessment } = await queries()
    const assessment = await completedAssessment()
    expect(await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment })).toEqual({ recorded: false, reason: 'unknown_answer' })
    const lookup = calls.find((c) => c.sql.startsWith('select'))!
    expect(lookup.sql).toMatch(/"kb_answers"\."id" = \$\d+ and "kb_answers"\."org_id" = \$\d+/)
    expect(lookup.params).toEqual(expect.arrayContaining([ANSWER, 3]))
    expect(writes()).toHaveLength(0)

    calls.length = 0
    respond = () => [['2026-10-25T10:00:00+00:00', 'failed']]
    expect(await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment })).toEqual({ recorded: false, reason: 'answer_not_generated' })
    expect(writes()).toHaveLength(0)
  })

  it('keys the insert on the answer and the method version, and stops there when it is already recorded', async () => {
    const { recordSupportAssessment } = await queries()
    respond = (c) => (c.sql.startsWith('select') ? [['2026-10-25T10:00:00+00:00', 'generated']] : [])
    const out = await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: await completedAssessment() })
    expect(out).toEqual({ recorded: false, reason: 'already_recorded' })
    const insert = calls.find((c) => c.sql.startsWith('insert into "kb_support_assessments"'))!
    expect(insert.sql).toContain('on conflict ("answer_id","method_version","rubric_version") do nothing')
    expect(insert.sql).not.toMatch(/article/)
    expect(writes()).toHaveLength(1)
  })

  it('stores a skipped or failed run with its reason and nothing under it', async () => {
    const { recordSupportAssessment } = await queries()
    respond = (c) => (c.sql.startsWith('select') ? [['2026-10-25T10:00:00+00:00', 'generated']] : c.sql.startsWith('insert') ? [[41]] : [])
    const base = await completedAssessment()
    const skipped: SupportAssessment = { ...base, execution: { state: 'skipped', reason: 'over_budget' }, answer: 'not_assessed', articles: [] }
    expect(await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: skipped })).toEqual({ recorded: true, assessmentId: 41 })
    const insert = calls.find((c) => c.sql.startsWith('insert into "kb_support_assessments"'))!
    expect(insert.params).toEqual(expect.arrayContaining(['skipped', 'over_budget', 'not_assessed']))
    expect(calls.some((c) => c.sql.includes('kb_answer_references') || c.sql.includes('kb_support_article_findings'))).toBe(false)

    calls.length = 0
    const failed: SupportAssessment = { ...base, execution: { state: 'failed', reason: 'timeout' }, answer: 'not_assessed', articles: [] }
    await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: failed })
    expect(calls.find((c) => c.sql.startsWith('insert into "kb_support_assessments"'))!.params).toEqual(expect.arrayContaining(['failed', 'timeout']))
  })

  it('writes one finding per assessed article from the reference rows, with the stored hash and without excerpt text by default', async () => {
    const { recordSupportAssessment } = await queries()
    scriptRecording(false)
    expect(await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: await completedAssessment() })).toEqual({ recorded: true, assessmentId: 41 })

    const articles = calls.find((c) => c.sql.startsWith('insert into "kb_support_article_findings"'))!
    expect(articles.params).toEqual(expect.arrayContaining([41, 7, 'hash-10', 'supporting', 8, 'hash-20', 'no_support']))
    const claims = calls.find((c) => c.sql.startsWith('insert into "kb_support_claim_findings"'))!
    expect(claims.params).toEqual(expect.arrayContaining([100, 1, 'supports', 2]))
    expect(claims.params.some((p) => typeof p === 'string' && p.includes('Forgot password'))).toBe(false)
  })

  it('writes bounded excerpt text with an expiry only when the workspace opted in, and reads the opt-in itself', async () => {
    const { recordSupportAssessment } = await queries()
    scriptRecording(true)
    await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: await completedAssessment() })
    expect(calls.some((c) => c.sql.includes('from "kb_support_settings"') && c.params.includes(3))).toBe(true)
    const claims = calls.find((c) => c.sql.startsWith('insert into "kb_support_claim_findings"'))!
    expect(claims.params).toContain('Choose Forgot password.')
    expect(claims.params).toContain('Open the sign-in page and choose Forgot password.')
    expect(claims.sql).toContain('make_interval')
    expect(claims.params).toContain(90)
  })

  it('gives no finding to an article the answer has no reference row for, or to one that was not assessed', async () => {
    const { recordSupportAssessment } = await queries()
    scriptRecording(false, [{ id: 7, article: 10 }])
    await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: await completedAssessment() })
    const articles = calls.find((c) => c.sql.startsWith('insert into "kb_support_article_findings"'))!
    expect(articles.params).toContain(7)
    expect(articles.params).not.toContain('hash-20')
  })

  it('writes no claim findings for "none", only for a claim tied to a passage', async () => {
    const { recordSupportAssessment } = await queries()
    scriptRecording(false)
    const assessment = await completedAssessment()
    const noClaims: SupportAssessment = {
      ...assessment,
      articles: assessment.articles.map((a) => ({ ...a, findings: a.findings.map((f) => ({ ...f, label: 'none' as const, passage: null, passageQuote: null })) })),
    }
    await recordSupportAssessment({ orgId: 3, answerId: ANSWER, assessment: noClaims })
    expect(calls.some((c) => c.sql.startsWith('insert into "kb_support_claim_findings"'))).toBe(false)
  })
})

describe('recordSupportFlag', () => {
  it('refuses a bad verdict or an overlong note before any query', async () => {
    const { recordSupportFlag, SupportFlagError } = await queries()
    const base = { orgId: 3, userId: 1, articleFindingId: 5 }
    await expect(recordSupportFlag({ ...base, verdict: 'maybe' as never })).rejects.toBeInstanceOf(SupportFlagError)
    await expect(recordSupportFlag({ ...base, verdict: 'agree', note: 'x'.repeat(501) })).rejects.toThrow(/500/)
    expect(calls).toHaveLength(0)
  })

  it('checks the finding belongs to this workspace, and writes nothing when it does not', async () => {
    const { recordSupportFlag } = await queries()
    await expect(recordSupportFlag({ orgId: 3, userId: 1, articleFindingId: 5, verdict: 'agree' })).rejects.toThrow(/not found/)
    const lookup = calls.find((c) => c.sql.startsWith('select'))!
    expect(lookup.sql).toMatch(/"kb_support_assessments"\."org_id" = \$/)
    expect(lookup.params).toEqual(expect.arrayContaining([5, 3]))
    expect(writes()).toHaveLength(0)
  })

  it('writes only to the flags table, upserting on the one flag a person has per target, and trims the note', async () => {
    const { recordSupportFlag } = await queries()
    respond = (c) =>
      c.sql.startsWith('select') ? [[5]] : c.sql.startsWith('insert') ? [rowOf(kbSupportFlags, { id: 1, org_id: 3, article_finding_id: 5, user_id: 1, verdict: 'disagree', note: 'Wrong.' })] : []
    await recordSupportFlag({ orgId: 3, userId: 1, articleFindingId: 5, verdict: 'disagree', note: '  Wrong.  ' })
    expect(writes().map((c) => c.sql.split(' ').slice(0, 3).join(' '))).toEqual(['insert into "kb_support_flags"'])
    const insert = writes()[0]
    expect(insert.sql).toContain('on conflict ("article_finding_id","user_id") where')
    expect(insert.sql).toContain('"claim_finding_id" is null')
    expect(insert.params).toContain('Wrong.')
    expect(insert.params).not.toContain('  Wrong.  ')
  })

  it('a claim flag is upserted on the claim, after checking the claim belongs to the finding', async () => {
    const { recordSupportFlag } = await queries()
    respond = (c) => (c.sql.startsWith('select') ? [[5]] : c.sql.startsWith('insert') ? [rowOf(kbSupportFlags, { id: 2, claim_finding_id: 9 })] : [])
    await recordSupportFlag({ orgId: 3, userId: 1, articleFindingId: 5, claimFindingId: 9, verdict: 'agree' })
    const claimCheck = calls.filter((c) => c.sql.startsWith('select')).find((c) => c.sql.includes('"kb_support_claim_findings"'))!
    expect(claimCheck.sql).toMatch(/"article_finding_id" = \$/)
    expect(claimCheck.params).toEqual(expect.arrayContaining([9, 5]))
    expect(writes()[0].sql).toContain('on conflict ("claim_finding_id","user_id") where')
  })
})

describe('getSupportForAnswer', () => {
  const assessmentRow = (over: Record<string, unknown> = {}) =>
    rowOf(kbSupportAssessments, { id: 41, org_id: 3, answer_id: ANSWER, method: 'judge+similarity', method_version: 1, rubric_version: 1, execution_state: 'completed', answer_summary: 'supporting', judge_model: 'fake', assessed_at: '2026-10-25T10:00:00+00:00', ...over })

  it('does not query for something that is not a UUID, and is scoped to the workspace otherwise', async () => {
    const { getSupportForAnswer } = await queries()
    expect(await getSupportForAnswer('nope', 3)).toBeNull()
    expect(calls).toHaveLength(0)
    expect(await getSupportForAnswer(ANSWER, 3)).toBeNull()
    expect(calls[0].sql).toMatch(/"kb_support_assessments"\."answer_id" = \$\d+ and "kb_support_assessments"\."org_id" = \$\d+/)
    expect(calls[0].params).toEqual(expect.arrayContaining([ANSWER, 3]))
  })

  it('reads the newest method version unless one is asked for', async () => {
    const { getSupportForAnswer } = await queries()
    await getSupportForAnswer(ANSWER, 3)
    expect(calls[0].sql).toMatch(/order by "kb_support_assessments"\."method_version" desc, "kb_support_assessments"\."rubric_version" desc/)
    calls.length = 0
    await getSupportForAnswer(ANSWER, 3, { methodVersion: 1, rubricVersion: 2 })
    expect(calls[0].sql).toMatch(/"method_version" = \$\d+ and "kb_support_assessments"\."rubric_version" = \$\d+/)
  })

  it('shows evidence text only while it has not expired, and says why it is missing otherwise', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const past = new Date(Date.now() - 3_600_000).toISOString()
    respond = (c) => {
      if (c.sql.includes('from "kb_support_assessments"')) return [assessmentRow()]
      if (c.sql.includes('from "kb_support_article_findings"')) return [[11, 7, 10, 'hash-10', 'supporting', ['x'].slice(1), []]]
      if (c.sql.includes('from "kb_support_claim_findings"'))
        return [
          rowOf(kbSupportClaimFindings, { id: 1, article_finding_id: 11, claim_index: 1, label: 'supports', passage_index: 1, claim_excerpt: 'kept', passage_excerpt: 'kept too', evidence_expires_at: future }),
          rowOf(kbSupportClaimFindings, { id: 2, article_finding_id: 11, claim_index: 2, label: 'supports', passage_index: 2, claim_excerpt: 'stale', passage_excerpt: 'stale too', evidence_expires_at: past }),
          rowOf(kbSupportClaimFindings, { id: 3, article_finding_id: 11, claim_index: 3, label: 'partial', passage_index: 1, claim_excerpt: null, passage_excerpt: null, evidence_expires_at: past }),
          rowOf(kbSupportClaimFindings, { id: 4, article_finding_id: 11, claim_index: 4, label: 'inconclusive', passage_index: 2, claim_excerpt: null, passage_excerpt: null, evidence_expires_at: null }),
        ]
      return []
    }
    const { getSupportForAnswer } = await queries()
    const record = (await getSupportForAnswer(ANSWER, 3))!
    expect(record.articles[0].claims.map((c) => [c.claimIndex, c.evidence, c.claimExcerpt, c.passageExcerpt])).toEqual([
      [1, 'available', 'kept', 'kept too'],
      [2, 'expired', null, null],
      [3, 'expired', null, null],
      [4, 'unavailable', null, null],
    ])
  })

  it('keeps a finding whose article was deleted, with a null article id', async () => {
    respond = (c) => {
      if (c.sql.includes('from "kb_support_assessments"')) return [assessmentRow()]
      if (c.sql.includes('from "kb_support_article_findings"')) return [[11, 7, null, 'hash-10', 'supporting', [], []]]
      return []
    }
    const { getSupportForAnswer } = await queries()
    expect((await getSupportForAnswer(ANSWER, 3))!.articles[0]).toMatchObject({ articleId: null, articleContentHash: 'hash-10', summary: 'supporting' })
  })
})

describe('getSupportCounts', () => {
  const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') }

  it('counts one method version for the workspace and the range, grouped in the database', async () => {
    const { getSupportCounts } = await queries()
    respond = (c) => (c.sql.includes('count(*)::int') && !c.sql.includes('group by') ? [[0]] : [])
    await getSupportCounts(3, { ...window, surfaces: ['ticket', 'widget'], methodVersion: 2, rubricVersion: 5 })
    const grouped = calls.filter((c) => c.sql.includes('group by'))
    expect(grouped).toHaveLength(2)
    for (const c of calls) {
      expect(c.sql).toMatch(/"kb_answers"\."org_id" = \$/)
      expect(c.params).toContain(3)
    }
    for (const c of grouped) {
      expect(c.sql).toMatch(/"kb_support_assessments"\."method_version" = \$/)
      expect(c.params).toEqual(expect.arrayContaining([2, 5, 'ticket', 'widget']))
      expect(c.sql).toContain("coalesce(")
    }
  })

  it('defaults to the current method version', async () => {
    const { getSupportCounts } = await queries()
    const { SUPPORT_METHOD } = await import('@/lib/kb/support')
    respond = (c) => (c.sql.includes('count(*)::int') && !c.sql.includes('group by') ? [[0]] : [])
    await getSupportCounts(3, window)
    const grouped = calls.find((c) => c.sql.includes('group by'))!
    expect(grouped.params).toEqual(expect.arrayContaining([SUPPORT_METHOD.version, SUPPORT_METHOD.rubric]))
  })

  it('turns the groups into buckets that sum to the supplied total', async () => {
    const { getSupportCounts } = await queries()
    respond = (c) => {
      if (c.sql.includes('group by') && c.sql.includes('"kb_answer_references"')) {
        return [['generated', 'supporting', 2], ['generated', 'no_support', 1], ['generated', 'not_assessed', 3], ['failed', 'not_assessed', 4]]
      }
      if (c.sql.includes('group by')) return [['generated', 'supporting', 2], ['generated', 'not_assessed', 2], ['failed', 'not_assessed', 1]]
      if (c.sql.includes('"kb_answer_references"')) return [[6]]
      return [[4]]
    }
    const counts = await getSupportCounts(3, window)
    expect(counts.pairs).toMatchObject({ supplied: 6, supporting: 2, noSupport: 1, notAssessed: 3, failed: { pairs: 4 } })
    expect(counts.pairs.supportRate).toEqual({ numerator: 2, denominator: 3 })
    expect(counts.answers).toMatchObject({ completed: 4, supporting: 2, notAssessed: 2, failed: { answers: 1 } })
  })

  it('throws instead of returning numbers that disagree with the independently counted total', async () => {
    const { getSupportCounts } = await queries()
    respond = (c) => {
      if (c.sql.includes('group by')) return [['generated', 'supporting', 2], ['generated', 'not_assessed', 2]]
      return [[5]] // the independent count says 5, the groups say 4
    }
    // (A fresh module copy per test, so match on the error's name rather than its class.)
    await expect(getSupportCounts(3, window)).rejects.toMatchObject({ name: 'ReconciliationError', message: 'Expected 5 supplied, found 4' })
  })
})

describe('sweepSupportAssessments', () => {
  it('removes expired text and old assessments, and counts each', async () => {
    const { sweepSupportAssessments } = await queries()
    respond = (c) => (c.sql.startsWith('update') ? [[1], [2], [3]] : c.sql.startsWith('delete') ? [[9]] : [])
    const now = new Date('2026-10-30T00:00:00Z')
    expect(await sweepSupportAssessments(90, now)).toEqual({ excerptsCleared: 3, assessmentsDeleted: 1 })

    const update = calls.find((c) => c.sql.startsWith('update "kb_support_claim_findings"'))!
    expect(update.sql).toContain('"claim_excerpt" = $')
    expect(update.sql).toContain('"evidence_expires_at" <= $')
    expect(update.sql).toMatch(/"claim_excerpt" is not null or "kb_support_claim_findings"\."passage_excerpt" is not null/)
    expect(update.params).toContain(now.toISOString())
    const del = calls.find((c) => c.sql.startsWith('delete from "kb_support_assessments"'))!
    expect(del.sql).toContain('"assessed_at" < $')
    expect(del.params).toContain(new Date('2026-08-01T00:00:00.000Z').toISOString())
  })

  it('uses the answer retention window by default, so there is one clock', async () => {
    const { sweepSupportAssessments } = await queries()
    const { ANSWER_REFERENCE_RETENTION_DAYS } = await import('@/lib/kb/coverage')
    const now = new Date('2026-10-30T00:00:00Z')
    await sweepSupportAssessments(undefined, now)
    const del = calls.find((c) => c.sql.startsWith('delete'))!
    expect(del.params).toContain(new Date(now.getTime() - ANSWER_REFERENCE_RETENTION_DAYS * 86_400_000).toISOString())
  })

  it.each([[0], [-1], [Number.NaN], [0.4]])('refuses a retention of %s days, touching nothing', async (days) => {
    const { sweepSupportAssessments } = await queries()
    await expect(sweepSupportAssessments(days)).rejects.toThrow(/positive integer/)
    expect(calls).toHaveLength(0)
  })
})
