// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupportSettings } from '@/lib/db/queries/kb-support'
import type { SupportAssessment } from '@/lib/kb/support'

/**
 * The post-reply source-support runner (#445), with the database, the model
 * layer, the logger and `after()` mocked. What it must guarantee: the reply is
 * returned before any assessment work starts and is the same whatever the
 * assessment does; every bound is recorded as skipped with its reason, in a
 * fixed order; a repeated callback assesses nothing twice; nothing it logs or
 * records carries the question or the answer beyond the bounded excerpts; and
 * each channel runs only behind its own switch.
 */

const h = vi.hoisted(() => ({
  findSupportSettings: vi.fn(),
  countSupportAssessmentsSince: vi.fn(),
  recordSupportAssessment: vi.fn(),
  judge: vi.fn(),
  liveJudge: vi.fn(),
  assessmentCostMicros: vi.fn(),
  embedTexts: vi.fn(),
  after: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/db/queries/kb-support', () => ({
  findSupportSettings: h.findSupportSettings,
  countSupportAssessmentsSince: h.countSupportAssessmentsSince,
  recordSupportAssessment: h.recordSupportAssessment,
}))
vi.mock('@/lib/ai/support-judge', () => ({ liveJudge: h.liveJudge, assessmentCostMicros: h.assessmentCostMicros }))
vi.mock('@/lib/ai/embed', () => ({ embedTexts: h.embedTexts }))
vi.mock('next/server', () => ({ after: h.after }))
vi.mock('@/lib/logger', () => ({ logger: h.logger }))

import {
  SUPPORT_MAX_CONCURRENT,
  resetRunnerStateForTests,
  runnerStateForTests,
  deferAfterResponse,
  isSampled,
  runSourceSupport,
  scheduleSourceSupport,
  startOfUtcDay,
  type Defer,
  type ScheduleSourceSupportInput,
} from '@/lib/kb/support/runner'
import { SUPPORT_COST_CEILING_MICROS } from '@/lib/kb/support/method'

const ANSWER_ID = '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44'
const SECRET_QUESTION = 'QUESTION-SENTINEL how do I reset my password for account 4412?'
const ANSWER_TEXT = 'Choose Forgot password on the sign-in page. The reset link expires after 60 minutes.'
const ARTICLE_TEXT = 'Open the sign-in page and choose Forgot password.\n\nThe reset link expires after 60 minutes.'

const ON: SupportSettings = {
  widgetEnabled: true,
  ticketEnabled: true,
  discordEnabled: true,
  agentApiEnabled: true,
  samplingRate: 1,
  dailyLimit: 100,
  excerptStorageEnabled: false,
}

function job(over: Partial<ScheduleSourceSupportInput> = {}): ScheduleSourceSupportInput {
  return {
    orgId: 3,
    answerId: ANSWER_ID,
    surface: 'widget',
    question: SECRET_QUESTION,
    answer: ANSWER_TEXT,
    context: [
      { articleId: 10, summary: 'Reset a password', answer: ARTICLE_TEXT },
      // A reused earlier ticket answer: no article id, so never part of the snapshot.
      { summary: 'Earlier ticket', answer: 'TICKET-SENTINEL internal notes' },
    ],
    ...over,
  }
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

const supportsBoth = {
  raw: {
    findings: [
      { claim: 1, article: 10, passage: 1, label: 'supports' },
      { claim: 2, article: 10, passage: 2, label: 'supports' },
    ],
    off_topic: [],
  },
  usage: { inputTokens: 900, outputTokens: 40 },
  modelId: 'judge-model',
}

/** The assessment the runner handed to storage, for the n-th call. */
const recorded = (n = 0) => h.recordSupportAssessment.mock.calls[n]?.[0] as { orgId: number; answerId: string; assessment: SupportAssessment }
const execution = (n = 0) => recorded(n)?.assessment.execution

/** A defer that holds tasks until the test releases them. */
function heldDefer() {
  const tasks: Array<() => Promise<void>> = []
  const defer: Defer = (task) => {
    tasks.push(task)
  }
  return { defer, tasks, runAll: () => Promise.all(tasks.splice(0).map((t) => t())) }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRunnerStateForTests()
  h.findSupportSettings.mockResolvedValue({ ...ON })
  h.countSupportAssessmentsSince.mockResolvedValue(0)
  h.recordSupportAssessment.mockResolvedValue({ recorded: true, assessmentId: 1 })
  h.judge.mockResolvedValue(supportsBoth)
  h.liveJudge.mockImplementation(() => h.judge)
  h.assessmentCostMicros.mockReturnValue(100)
  h.embedTexts.mockImplementation(async (texts: string[]) => ({ embeddings: texts.map(() => [1, 0]), tokens: 12, model: 'embed-model' }))
  h.after.mockImplementation(() => {
    throw new Error('`after` was called outside a request scope.')
  })
})

describe('the reply comes first', () => {
  // A stand-in for a call site: records, schedules, returns the reply.
  async function handler(defer: Defer, input = job()): Promise<string> {
    scheduleSourceSupport(input, { defer })
    return `REPLY:${input.answer}`
  }

  it('returns the reply before the assessment starts, and only then does any assessment work run', async () => {
    const held = heldDefer()
    const reply = await handler(held.defer)

    expect(reply).toBe(`REPLY:${ANSWER_TEXT}`)
    expect(held.tasks).toHaveLength(1)
    expect(h.findSupportSettings).not.toHaveBeenCalled()
    expect(h.judge).not.toHaveBeenCalled()

    await held.runAll()
    expect(h.judge).toHaveBeenCalledTimes(1)
    expect(execution()).toEqual({ state: 'completed' })
  })

  it('schedules synchronously and returns nothing the caller could await', () => {
    const held = heldDefer()
    expect(scheduleSourceSupport(job(), { defer: held.defer })).toBeUndefined()
  })

  it.each([
    ['on', () => {}],
    ['off', () => h.findSupportSettings.mockResolvedValue({ ...ON, widgetEnabled: false })],
    ['failing', () => h.judge.mockRejectedValue(new Error('provider down'))],
    ['throwing everywhere', () => {
      h.findSupportSettings.mockRejectedValue(new Error('db down'))
      h.recordSupportAssessment.mockRejectedValue(new Error('db down'))
    }],
    ['timing out', () => h.judge.mockImplementation(() => new Promise(() => {}))],
  ])('gives the same reply, at once, with assessment %s', async (_label, arrange) => {
    arrange()
    const held = heldDefer()
    const reply = await handler(held.defer)
    expect(reply).toBe(`REPLY:${ANSWER_TEXT}`)
    expect(held.tasks).toHaveLength(1)
    // The held work, whatever it does, never rejects back into anything.
    await expect(Promise.race([held.runAll(), new Promise((r) => setTimeout(r, 30))])).resolves.not.toThrow()
  })

  it('never throws even when the deferral itself throws, and frees the answer id', () => {
    const throwing: Defer = () => {
      throw new Error('scheduler broke')
    }
    expect(() => scheduleSourceSupport(job(), { defer: throwing })).not.toThrow()
    expect(runnerStateForTests().inFlight).toBe(0)
    expect(h.logger.warn).toHaveBeenCalledWith('source support could not be scheduled', expect.objectContaining({ errorClass: 'Error' }))
  })

  it('never throws even when logging fails as well', () => {
    h.logger.warn.mockImplementationOnce(() => {
      throw new Error('logger broke')
    })
    expect(() =>
      scheduleSourceSupport(job(), {
        defer: () => {
          throw new Error('scheduler broke')
        },
      })
    ).not.toThrow()
  })

  it('uses after() inside a request scope', async () => {
    const queued: Array<() => Promise<void>> = []
    h.after.mockImplementation((task: () => Promise<void>) => {
      queued.push(task)
    })
    scheduleSourceSupport(job())
    expect(h.after).toHaveBeenCalledTimes(1)
    expect(h.findSupportSettings).not.toHaveBeenCalled()
    await queued[0]()
    expect(h.findSupportSettings).toHaveBeenCalledWith(3)
  })

  it('falls back to an in-process fire-and-forget on a later turn when there is no request scope', async () => {
    scheduleSourceSupport(job())
    expect(h.after).toHaveBeenCalledTimes(1)
    // Not started in the same turn as the caller.
    expect(h.findSupportSettings).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(h.recordSupportAssessment).toHaveBeenCalledTimes(1))
    expect(execution()).toEqual({ state: 'completed' })
  })

  it('deferAfterResponse does not run the task synchronously on either path', () => {
    const task = vi.fn(async () => {})
    deferAfterResponse(task)
    expect(task).not.toHaveBeenCalled()
    h.after.mockImplementation(() => {})
    deferAfterResponse(task)
    expect(task).not.toHaveBeenCalled()
  })

  it('copies the inputs when scheduled, so later changes by the caller never reach the assessment', async () => {
    const input = job()
    const held = heldDefer()
    scheduleSourceSupport(input, { defer: held.defer })
    ;(input.context as Array<{ articleId?: number; summary: string; answer: string }>)[0].answer = 'changed after the reply'
    input.answer = 'changed after the reply'
    await held.runAll()
    const prompt = h.judge.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Forgot password')
    expect(prompt).not.toContain('changed after the reply')
  })
})

describe('bounds, each recorded as skipped with its reason', () => {
  const run = (over: Partial<ScheduleSourceSupportInput> = {}, now?: Date) =>
    runSourceSupport(job(over), now ? { now: () => now } : {})

  it('the channel switch off is disabled', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, widgetEnabled: false })
    await run()
    expect(execution()).toEqual({ state: 'skipped', reason: 'disabled' })
    expect(h.judge).not.toHaveBeenCalled()
    expect(h.countSupportAssessmentsSince).not.toHaveBeenCalled()
  })

  it('a workspace that never changed a switch records nothing at all', async () => {
    h.findSupportSettings.mockResolvedValue(null)
    await run()
    expect(h.recordSupportAssessment).not.toHaveBeenCalled()
    expect(h.judge).not.toHaveBeenCalled()
  })

  it('an unset sampling rate is not_sampled', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, samplingRate: null })
    await run()
    expect(execution()).toEqual({ state: 'skipped', reason: 'not_sampled' })
  })

  it('a sampling rate of 0 is not_sampled', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, samplingRate: 0 })
    await run()
    expect(execution()).toEqual({ state: 'skipped', reason: 'not_sampled' })
  })

  it('an answer outside the rate is not_sampled', async () => {
    // Find an id that a 50% rate leaves out.
    const out = Array.from({ length: 200 }, (_, i) => uuid(i)).find((id) => !isSampled(id, 0.5))!
    h.findSupportSettings.mockResolvedValue({ ...ON, samplingRate: 0.5 })
    await run({ answerId: out })
    expect(execution()).toEqual({ state: 'skipped', reason: 'not_sampled' })
  })

  it('an unset daily limit is over_budget', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: null })
    await run()
    expect(execution()).toEqual({ state: 'skipped', reason: 'over_budget' })
    expect(h.judge).not.toHaveBeenCalled()
  })

  it('a daily limit of 0 is over_budget', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: 0 })
    await run()
    expect(execution()).toEqual({ state: 'skipped', reason: 'over_budget' })
  })

  it("a limit reached by today's completed and failed checks is over_budget, counted from midnight UTC", async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: 5 })
    h.countSupportAssessmentsSince.mockResolvedValue(5)
    const now = new Date('2026-11-09T23:59:00-05:00')
    await run({}, now)
    expect(execution()).toEqual({ state: 'skipped', reason: 'over_budget' })
    expect(h.countSupportAssessmentsSince).toHaveBeenCalledWith(3, new Date('2026-11-10T00:00:00.000Z'))
  })

  it('one below the limit still runs', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: 5 })
    h.countSupportAssessmentsSince.mockResolvedValue(4)
    await run()
    expect(execution()).toEqual({ state: 'completed' })
  })

  it('counts this process’s running checks against the limit, so a burst cannot all pass', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: 1 })
    let release!: () => void
    h.judge.mockImplementationOnce(() => new Promise((r) => (release = () => r(supportsBoth))))
    const first = run({ answerId: uuid(1) })
    await vi.waitFor(() => expect(h.judge).toHaveBeenCalledTimes(1))
    await run({ answerId: uuid(2) })
    expect(h.recordSupportAssessment.mock.calls.at(-1)![0].assessment.execution).toEqual({ state: 'skipped', reason: 'over_budget' })
    release()
    await first
  })

  it(`more than ${SUPPORT_MAX_CONCURRENT} at once is over_cap, and the slot frees when one finishes`, async () => {
    const releases: Array<() => void> = []
    h.judge.mockImplementation(() => new Promise((r) => releases.push(() => r(supportsBoth))))
    const running = Array.from({ length: SUPPORT_MAX_CONCURRENT }, (_, i) => run({ answerId: uuid(i + 1), orgId: 100 + i }))
    await vi.waitFor(() => expect(h.judge).toHaveBeenCalledTimes(SUPPORT_MAX_CONCURRENT))
    expect(runnerStateForTests().running).toBe(SUPPORT_MAX_CONCURRENT)

    await run({ answerId: uuid(99) })
    expect(h.recordSupportAssessment.mock.calls.at(-1)![0]).toMatchObject({
      answerId: uuid(99),
      assessment: { execution: { state: 'skipped', reason: 'over_cap' } },
    })

    releases.forEach((r) => r())
    await Promise.all(running)
    expect(runnerStateForTests().running).toBe(0)
    expect(runnerStateForTests().runningByOrg.size).toBe(0)
  })

  it('an answer with no claims is no_claims, with no model call', async () => {
    await run({ answer: '   ' })
    expect(execution()).toEqual({ state: 'skipped', reason: 'no_claims' })
    expect(h.judge).not.toHaveBeenCalled()
  })

  it('checks the bounds in order: disabled before not_sampled before over_budget', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, widgetEnabled: false, samplingRate: null, dailyLimit: null })
    await run()
    expect(execution()).toEqual({ state: 'skipped', reason: 'disabled' })

    h.findSupportSettings.mockResolvedValue({ ...ON, samplingRate: null, dailyLimit: null })
    await run()
    expect(execution(1)).toEqual({ state: 'skipped', reason: 'not_sampled' })
  })

  it('a skipped assessment is not assessed, has no findings and spent nothing', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: null })
    await run()
    const a = recorded().assessment
    expect(a.answer).toBe('not_assessed')
    expect(a.articles).toEqual([])
    expect(a.usage).toEqual({ judgeInputTokens: 0, judgeOutputTokens: 0, embeddingTokens: 0 })
  })
})

describe('failures are recorded and stay inside the runner', () => {
  it('a provider error is recorded as failed / provider_error', async () => {
    h.judge.mockRejectedValue(new Error('no provider'))
    await runSourceSupport(job())
    expect(execution()).toEqual({ state: 'failed', reason: 'provider_error' })
  })

  it('a hung judge ends by the timeout and is recorded as failed / timeout', async () => {
    h.judge.mockImplementation(() => new Promise(() => {}))
    await runSourceSupport(job(), { timeoutMs: 20 })
    expect(execution()).toEqual({ state: 'failed', reason: 'timeout' })
    expect(runnerStateForTests().running).toBe(0)
  })

  it('a hung embedding call ends by the same timeout and lowers support instead of hanging', async () => {
    h.embedTexts.mockImplementation(() => new Promise(() => {}))
    await runSourceSupport(job(), { timeoutMs: 20 })
    const a = recorded().assessment
    expect(a.execution).toEqual({ state: 'completed' })
    expect(a.similarity.unavailable).toBe(true)
    expect(a.answer).not.toBe('supporting')
  })

  it('an unexpected error before recording is recorded as failed / interrupted and logged by class only', async () => {
    h.countSupportAssessmentsSince.mockRejectedValue(new TypeError('connection reset'))
    await expect(runSourceSupport(job())).resolves.toBeUndefined()
    expect(execution()).toEqual({ state: 'failed', reason: 'interrupted' })
    expect(h.logger.warn).toHaveBeenCalledWith('source support assessment failed', {
      module: 'kb/support/runner',
      orgId: 3,
      answerId: ANSWER_ID,
      surface: 'widget',
      errorClass: 'TypeError',
    })
  })

  it('a failed write is logged and not retried as a second row', async () => {
    h.recordSupportAssessment.mockRejectedValue(new Error('write failed'))
    await expect(runSourceSupport(job())).resolves.toBeUndefined()
    expect(h.recordSupportAssessment).toHaveBeenCalledTimes(1)
  })

  it('if recording the failure fails too, it still resolves', async () => {
    h.findSupportSettings.mockRejectedValue(new Error('db down'))
    h.recordSupportAssessment.mockRejectedValue(new Error('db down'))
    await expect(runSourceSupport(job())).resolves.toBeUndefined()
    expect(h.logger.warn).toHaveBeenCalledWith('source support failure could not be recorded', expect.objectContaining({ errorClass: 'Error' }))
  })

  it('logs, but does not enforce, an assessment that cost more than its ceiling', async () => {
    h.assessmentCostMicros.mockReturnValue(SUPPORT_COST_CEILING_MICROS + 1)
    await runSourceSupport(job())
    expect(h.assessmentCostMicros).toHaveBeenCalledWith(
      { judgeInputTokens: 900, judgeOutputTokens: 40, embeddingTokens: 12 },
      'judge-model',
      'embed-model'
    )
    expect(h.logger.warn).toHaveBeenCalledWith(
      'source support assessment cost more than its ceiling',
      expect.objectContaining({ costMicros: SUPPORT_COST_CEILING_MICROS + 1 })
    )
    expect(execution()).toEqual({ state: 'completed' })
  })
})

describe('idempotency', () => {
  it('a repeated callback while the first is in flight schedules nothing', async () => {
    const held = heldDefer()
    scheduleSourceSupport(job(), { defer: held.defer })
    scheduleSourceSupport(job(), { defer: held.defer })
    expect(held.tasks).toHaveLength(1)
    await held.runAll()
    expect(h.recordSupportAssessment).toHaveBeenCalledTimes(1)
    expect(runnerStateForTests().inFlight).toBe(0)
  })

  it('a repeat after the first finished relies on the storage key and does nothing more', async () => {
    const held = heldDefer()
    scheduleSourceSupport(job(), { defer: held.defer })
    await held.runAll()
    h.recordSupportAssessment.mockResolvedValue({ recorded: false, reason: 'already_recorded' })
    scheduleSourceSupport(job(), { defer: held.defer })
    await held.runAll()
    expect(h.recordSupportAssessment).toHaveBeenCalledTimes(2)
    expect(h.logger.debug).toHaveBeenCalledWith('source support assessment not recorded', expect.objectContaining({ reason: 'already_recorded' }))
    expect(h.logger.warn).not.toHaveBeenCalled()
  })

  it('an answer id that is not a UUID is never scheduled', () => {
    const held = heldDefer()
    scheduleSourceSupport(job({ answerId: 'not-a-uuid' }), { defer: held.defer })
    expect(held.tasks).toHaveLength(0)
  })
})

describe('no question or answer text in logs or rows', () => {
  const everyLog = () => JSON.stringify(Object.values(h.logger).flatMap((fn) => fn.mock.calls))

  it.each([
    ['completed', () => {}],
    ['failing', () => h.judge.mockRejectedValue(new Error(`provider said: ${SECRET_QUESTION}`))],
    ['broken', () => h.countSupportAssessmentsSince.mockRejectedValue(new Error(`query failed with ${ANSWER_TEXT}`))],
    ['skipped', () => h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: null })],
  ])('%s: logs carry no question, answer or article text', async (_label, arrange) => {
    arrange()
    h.assessmentCostMicros.mockReturnValue(SUPPORT_COST_CEILING_MICROS + 1)
    await runSourceSupport(job())
    const logs = everyLog()
    expect(logs).not.toContain('QUESTION-SENTINEL')
    expect(logs).not.toContain('Forgot password')
    expect(logs).not.toContain('60 minutes')
    expect(logs).not.toContain('TICKET-SENTINEL')
  })

  it('the recorded assessment holds no question text, no full answer and no string past the excerpt limit', async () => {
    const longAnswer = `${ANSWER_TEXT} ${'Extra detail follows here. '.repeat(30)}`
    await runSourceSupport(job({ answer: longAnswer }))
    const row = JSON.stringify(recorded())
    expect(row).not.toContain('QUESTION-SENTINEL')
    expect(row).not.toContain('TICKET-SENTINEL')
    expect(row).not.toContain(longAnswer)
    const strings: string[] = []
    JSON.parse(row, (_k, v) => (typeof v === 'string' && strings.push(v), v))
    for (const s of strings) expect(s.length).toBeLessThanOrEqual(300)
  })

  it('reused ticket answers without an article id never reach the judge', async () => {
    await runSourceSupport(job())
    expect(h.judge.mock.calls[0][0].prompt).not.toContain('TICKET-SENTINEL')
  })
})

describe('each channel runs only behind its own switch', () => {
  const switches = {
    widget: 'widgetEnabled',
    ticket: 'ticketEnabled',
    discord: 'discordEnabled',
    agent_api: 'agentApiEnabled',
  } as const

  it.each(Object.entries(switches))('%s is assessed only when %s is on', async (surface, key) => {
    const only: SupportSettings = { ...ON, widgetEnabled: false, ticketEnabled: false, discordEnabled: false, agentApiEnabled: false, [key]: true }
    h.findSupportSettings.mockResolvedValue(only)

    for (const [i, other] of Object.keys(switches).entries()) {
      await runSourceSupport(job({ surface: other as ScheduleSourceSupportInput['surface'], answerId: uuid(i + 1) }))
    }
    const outcomes = h.recordSupportAssessment.mock.calls.map((c, i) => [Object.keys(switches)[i], c[0].assessment.execution])
    expect(Object.fromEntries(outcomes)).toEqual(
      Object.fromEntries(
        Object.keys(switches).map((s) => [s, s === surface ? { state: 'completed' } : { state: 'skipped', reason: 'disabled' }])
      )
    )
    expect(h.judge).toHaveBeenCalledTimes(1)
  })
})

describe('deterministic sampling', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => uuid(i + 1))

  it('decides the same way every time for the same answer', () => {
    for (const id of ids.slice(0, 50)) expect(isSampled(id, 0.37)).toBe(isSampled(id, 0.37))
  })

  it('takes nothing at 0 or unset, everything at 1', () => {
    expect(ids.some((id) => isSampled(id, 0))).toBe(false)
    expect(ids.some((id) => isSampled(id, null))).toBe(false)
    expect(ids.every((id) => isSampled(id, 1))).toBe(true)
  })

  it('takes roughly the share asked for', () => {
    const taken = ids.filter((id) => isSampled(id, 0.25)).length
    expect(taken).toBeGreaterThan(400)
    expect(taken).toBeLessThan(600)
  })

  it('raising the rate only ever adds answers', () => {
    for (const id of ids) if (isSampled(id, 0.2)) expect(isSampled(id, 0.6)).toBe(true)
  })

  it('does not use Math.random', async () => {
    const spy = vi.spyOn(Math, 'random')
    isSampled(ANSWER_ID, 0.5)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('a repeated run of the same answer decides identically', async () => {
    const id = ids.find((x) => isSampled(x, 0.5))!
    h.findSupportSettings.mockResolvedValue({ ...ON, samplingRate: 0.5 })
    await runSourceSupport(job({ answerId: id }))
    await runSourceSupport(job({ answerId: id }))
    expect(execution(0)).toEqual(execution(1))
  })
})

describe('startOfUtcDay', () => {
  it('is midnight UTC of the same UTC day', () => {
    expect(startOfUtcDay(new Date('2026-11-09T00:00:00.000Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(startOfUtcDay(new Date('2026-11-09T23:59:59.999Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
  })
})
