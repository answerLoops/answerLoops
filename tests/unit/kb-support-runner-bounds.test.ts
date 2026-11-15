// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupportSettings } from '@/lib/db/queries/kb-support'

/**
 * Regression guards for the runner's resource bookkeeping, complementing
 * kb-support-runner.test.ts: the order the over_budget and over_cap bounds are
 * applied in, that a skipped or over-cap answer never holds a slot, that the
 * concurrency slot and the per-answer in-flight marker are released on every
 * failure path (the `finally` blocks), and that a bound that stops an answer
 * also stops the work behind it (no count query, no model call).
 */

const h = vi.hoisted(() => ({
  findSupportSettings: vi.fn(),
  countSupportAssessmentsSince: vi.fn(),
  recordSupportAssessment: vi.fn(),
  judge: vi.fn(),
  liveJudge: vi.fn(),
  assessmentCostMicros: vi.fn(),
  embedTexts: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/db/queries/kb-support', () => ({
  findSupportSettings: h.findSupportSettings,
  countSupportAssessmentsSince: h.countSupportAssessmentsSince,
  recordSupportAssessment: h.recordSupportAssessment,
}))
vi.mock('@/lib/ai/support-judge', () => ({ liveJudge: h.liveJudge, assessmentCostMicros: h.assessmentCostMicros }))
vi.mock('@/lib/ai/embed', () => ({ embedTexts: h.embedTexts }))
vi.mock('next/server', () => ({
  after: () => {
    throw new Error('outside a request scope')
  },
}))
vi.mock('@/lib/logger', () => ({ logger: h.logger }))

import {
  SUPPORT_MAX_CONCURRENT,
  resetRunnerStateForTests,
  runnerStateForTests,
  runSourceSupport,
  scheduleSourceSupport,
  type Defer,
  type ScheduleSourceSupportInput,
} from '@/lib/kb/support/runner'

const ON: SupportSettings = {
  widgetEnabled: true,
  ticketEnabled: true,
  discordEnabled: true,
  agentApiEnabled: true,
  samplingRate: 1,
  dailyLimit: 100,
  excerptStorageEnabled: false,
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

function job(over: Partial<ScheduleSourceSupportInput> = {}): ScheduleSourceSupportInput {
  return {
    orgId: 3,
    answerId: uuid(1),
    surface: 'widget',
    question: 'How do I reset my password?',
    answer: 'Choose Forgot password on the sign-in page.',
    context: [{ articleId: 10, summary: 'Reset a password', answer: 'Open the sign-in page and choose Forgot password.' }],
    ...over,
  }
}

const supports = {
  raw: { findings: [{ claim: 1, article: 10, passage: 1, label: 'supports' }], off_topic: [] },
  usage: { inputTokens: 10, outputTokens: 5 },
  modelId: 'judge-model',
}

const executions = () => h.recordSupportAssessment.mock.calls.map((c) => c[0].assessment.execution)
const idle = () => expect(runnerStateForTests()).toEqual({ inFlight: 0, running: 0, runningByOrg: new Map() })

beforeEach(() => {
  vi.clearAllMocks()
  resetRunnerStateForTests()
  h.findSupportSettings.mockResolvedValue({ ...ON })
  h.countSupportAssessmentsSince.mockResolvedValue(0)
  h.recordSupportAssessment.mockResolvedValue({ recorded: true, assessmentId: 1 })
  h.judge.mockResolvedValue(supports)
  h.liveJudge.mockImplementation(() => h.judge)
  h.assessmentCostMicros.mockReturnValue(1)
  h.embedTexts.mockImplementation(async (texts: string[]) => ({ embeddings: texts.map(() => [1, 0]), tokens: 1, model: 'embed-model' }))
})

/** Starts SUPPORT_MAX_CONCURRENT runs (one per org) that hold their slot until released. */
async function fillAllSlots() {
  const releases: Array<() => void> = []
  h.judge.mockImplementation(() => new Promise((r) => releases.push(() => r(supports))))
  const runs = Array.from({ length: SUPPORT_MAX_CONCURRENT }, (_, i) => runSourceSupport(job({ orgId: 100 + i, answerId: uuid(10 + i) })))
  await vi.waitFor(() => expect(h.judge).toHaveBeenCalledTimes(SUPPORT_MAX_CONCURRENT))
  return { release: () => releases.forEach((r) => r()), settled: () => Promise.all(runs) }
}

describe('order of the bounds', () => {
  it('over_budget is decided before over_cap: a full process still reports a spent daily limit as over_budget', async () => {
    const slots = await fillAllSlots()
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: 5 })
    h.countSupportAssessmentsSince.mockResolvedValue(5)
    await runSourceSupport(job({ orgId: 3, answerId: uuid(50) }))
    expect(h.recordSupportAssessment.mock.calls.at(-1)![0].assessment.execution).toEqual({ state: 'skipped', reason: 'over_budget' })
    slots.release()
    await slots.settled()
  })

  it('not_sampled and disabled stop the answer before the daily count is queried', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, samplingRate: null })
    await runSourceSupport(job())
    h.findSupportSettings.mockResolvedValue({ ...ON, widgetEnabled: false })
    await runSourceSupport(job({ answerId: uuid(2) }))
    expect(executions()).toEqual([
      { state: 'skipped', reason: 'not_sampled' },
      { state: 'skipped', reason: 'disabled' },
    ])
    expect(h.countSupportAssessmentsSince).not.toHaveBeenCalled()
  })

  it('an unset or zero limit stops the answer before the daily count is queried', async () => {
    h.findSupportSettings.mockResolvedValue({ ...ON, dailyLimit: null })
    await runSourceSupport(job())
    expect(h.countSupportAssessmentsSince).not.toHaveBeenCalled()
  })

  it('the daily count is the one for this workspace', async () => {
    await runSourceSupport(job({ orgId: 42 }))
    expect(h.countSupportAssessmentsSince).toHaveBeenCalledWith(42, expect.any(Date))
  })
})

describe('slots are held only by work that runs, and always released', () => {
  it('a skipped answer (every skip reason) never holds a slot', async () => {
    for (const [i, settings] of [
      { ...ON, widgetEnabled: false },
      { ...ON, samplingRate: 0 },
      { ...ON, dailyLimit: 0 },
    ].entries()) {
      h.findSupportSettings.mockResolvedValue(settings)
      await runSourceSupport(job({ answerId: uuid(i + 1) }))
      expect(runnerStateForTests().running).toBe(0)
    }
    h.findSupportSettings.mockResolvedValue({ ...ON })
    await runSourceSupport(job({ answer: '   ' }))
    expect(executions().at(-1)).toEqual({ state: 'skipped', reason: 'no_claims' })
    idle()
  })

  it('an over_cap answer takes no slot of its own, and releasing the others leaves the counters at zero', async () => {
    const slots = await fillAllSlots()
    await runSourceSupport(job({ orgId: 7, answerId: uuid(60) }))
    expect(executions().at(-1)).toEqual({ state: 'skipped', reason: 'over_cap' })
    expect(runnerStateForTests().running).toBe(SUPPORT_MAX_CONCURRENT)
    expect(runnerStateForTests().runningByOrg.has(7)).toBe(false)
    slots.release()
    await slots.settled()
    idle()
  })

  it('an over_cap answer never reaches the model', async () => {
    const slots = await fillAllSlots()
    h.judge.mockClear()
    h.liveJudge.mockClear()
    await runSourceSupport(job({ orgId: 7, answerId: uuid(61) }))
    expect(h.liveJudge).not.toHaveBeenCalled()
    expect(h.judge).not.toHaveBeenCalled()
    slots.release()
    await slots.settled()
  })

  it('a slot freed by one run is usable by the next', async () => {
    const slots = await fillAllSlots()
    slots.release()
    await slots.settled()
    h.judge.mockResolvedValue(supports)
    await runSourceSupport(job({ orgId: 7, answerId: uuid(62) }))
    expect(executions().at(-1)).toEqual({ state: 'completed' })
  })

  it.each([
    ['the model layer cannot be built', () => h.liveJudge.mockImplementation(() => { throw new Error('no provider configured') })],
    ['recording the result throws', () => h.recordSupportAssessment.mockRejectedValue(new Error('db down'))],
    ['the embedding call throws', () => h.embedTexts.mockRejectedValue(new Error('embed down'))],
    ['the judge throws', () => h.judge.mockRejectedValue(new Error('judge down'))],
  ])('releases the slot and the org counter when %s', async (_label, arrange) => {
    arrange()
    await expect(runSourceSupport(job())).resolves.toBeUndefined()
    idle()
  })

  it('releases the slot when the cost check itself throws after the result was recorded', async () => {
    h.assessmentCostMicros.mockImplementation(() => {
      throw new Error('price table missing')
    })
    await expect(runSourceSupport(job())).resolves.toBeUndefined()
    expect(h.recordSupportAssessment).toHaveBeenCalledTimes(1)
    expect(executions()).toEqual([{ state: 'completed' }])
    idle()
  })

  it('does not release a slot it never took when the failure comes before the gate', async () => {
    const slots = await fillAllSlots()
    h.findSupportSettings.mockRejectedValue(new Error('db down'))
    await runSourceSupport(job({ orgId: 7, answerId: uuid(63) }))
    expect(runnerStateForTests().running).toBe(SUPPORT_MAX_CONCURRENT)
    slots.release()
    await slots.settled()
    idle()
  })

  it('a pre-gate failure is recorded as interrupted and never calls the model', async () => {
    h.countSupportAssessmentsSince.mockRejectedValue(new Error('db down'))
    await runSourceSupport(job())
    expect(executions()).toEqual([{ state: 'failed', reason: 'interrupted' }])
    expect(h.liveJudge).not.toHaveBeenCalled()
  })

  it('a recorded result is never followed by a second "interrupted" row when a later step throws', async () => {
    h.assessmentCostMicros.mockImplementation(() => {
      throw new Error('late failure')
    })
    await runSourceSupport(job())
    expect(h.recordSupportAssessment).toHaveBeenCalledTimes(1)
  })
})

describe('the in-flight marker is released with the run', () => {
  const held = () => {
    const tasks: Array<() => Promise<void>> = []
    const defer: Defer = (t) => void tasks.push(t)
    return { defer, tasks }
  }

  it.each([
    ['completes', () => {}],
    ['fails', () => h.judge.mockRejectedValue(new Error('judge down'))],
    ['finds the workspace unconfigured', () => h.findSupportSettings.mockResolvedValue(null)],
    ['cannot read settings or record', () => {
      h.findSupportSettings.mockRejectedValue(new Error('db down'))
      h.recordSupportAssessment.mockRejectedValue(new Error('db down'))
    }],
  ])('a run that %s frees its answer id so it is never stuck', async (_label, arrange) => {
    arrange()
    const { defer, tasks } = held()
    scheduleSourceSupport(job(), { defer })
    expect(runnerStateForTests().inFlight).toBe(1)
    await tasks[0]()
    idle()
  })

  it('a run still holding its slot keeps the answer in flight, so a repeat callback is dropped', async () => {
    let release!: () => void
    h.judge.mockImplementation(() => new Promise((r) => (release = () => r(supports))))
    const { defer, tasks } = held()
    scheduleSourceSupport(job(), { defer })
    const running = tasks[0]()
    await vi.waitFor(() => expect(h.judge).toHaveBeenCalled())
    scheduleSourceSupport(job(), { defer })
    expect(tasks).toHaveLength(1)
    release()
    await running
    idle()
  })

  it('different answers for the same workspace are scheduled independently', () => {
    const { defer, tasks } = held()
    scheduleSourceSupport(job({ answerId: uuid(1) }), { defer })
    scheduleSourceSupport(job({ answerId: uuid(2) }), { defer })
    expect(tasks).toHaveLength(2)
  })
})
