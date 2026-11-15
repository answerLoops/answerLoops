import { createHash } from 'node:crypto'
import { after } from 'next/server'
import {
  countSupportAssessmentsSince,
  findSupportSettings,
  recordSupportAssessment,
  type SupportSettings,
} from '@/lib/db/queries/kb-support'
import { logger } from '@/lib/logger'
import type { KBAnswerSurface } from '@/types'
import { assessSupport, type SupportAssessment } from './assess'
import { JUDGE_TIMEOUT_MS, SUPPORT_COST_CEILING_MICROS, SUPPORT_METHOD } from './method'
import { buildSnapshot, type SuppliedArticle } from './snapshot'
import type { EmbedFn } from './similarity'
import type { Execution, FailReason, SkipReason } from './state'
import { deriveAnswerSupport } from './summary'

/**
 * The source-support runner (#445): assesses a generated answer against the
 * articles it was supplied, after the reply has gone out. It is server-only and
 * deliberately not exported from the pure `lib/kb/support` index, which has no
 * database and no model.
 *
 * There is no durable queue and nothing is stored to run later. The inputs live
 * only in the closure handed to the deferral, so if the process stops first
 * the answer stays "not assessed", which the counts already show honestly.
 *
 * Mechanism per surface: the widget, Discord `/ask` and Agent API answers are
 * produced inside route handlers, where `after()` from `next/server` runs the
 * work once the response has finished. The ticket draft runs inside the
 * ingestion pipeline's own `after()` callback (nested `after()` is supported)
 * or, from the stuck-ticket sweep, inside a request. Anywhere `after()` has no
 * request scope (it throws there: the Discord bot process, scripts, tests) the
 * work falls back to a guarded in-process fire-and-forget on the next turn of
 * the event loop. Either way the caller has already moved on.
 */

const MOD = 'kb/support/runner'

/** The most assessments one process runs at once. Anything over it is recorded as skipped (`over_cap`). */
export const SUPPORT_MAX_CONCURRENT = 4

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SURFACE_SWITCH: Record<KBAnswerSurface, keyof SupportSettings> = {
  widget: 'widgetEnabled',
  ticket: 'ticketEnabled',
  discord: 'discordEnabled',
  agent_api: 'agentApiEnabled',
}

/** One supplied context entry, in the shape every call site already holds. Entries without `articleId` are not articles. */
export interface SupportContextEntry {
  articleId?: number
  summary: string
  answer: string
}

export interface ScheduleSourceSupportInput {
  orgId: number
  answerId: string
  surface: KBAnswerSurface
  question: string
  answer: string
  context: ReadonlyArray<SupportContextEntry>
}

/** Runs a task after the caller has moved on. The task never rejects. */
export type Defer = (task: () => Promise<void>) => void

/**
 * The default deferral: `after()` inside a request scope, otherwise the next
 * turn of the event loop. `after()` throws synchronously outside a request
 * scope, which is the signal to fall back.
 */
export const deferAfterResponse: Defer = (task) => {
  try {
    after(task)
    return
  } catch {
    // Not inside a request (the bot process, a script, a test): run it in process instead.
  }
  setTimeout(() => {
    void task()
  }, 0)
}

// --- process-local state ----------------------------------------------------

/** Answers scheduled in this process and not yet finished, so a repeated callback schedules nothing. */
const inFlight = new Set<string>()
let running = 0
const runningByOrg = new Map<number, number>()

function reserveSlot(orgId: number): void {
  running++
  runningByOrg.set(orgId, (runningByOrg.get(orgId) ?? 0) + 1)
}

function releaseSlot(orgId: number): void {
  running = Math.max(0, running - 1)
  const left = (runningByOrg.get(orgId) ?? 1) - 1
  if (left > 0) runningByOrg.set(orgId, left)
  else runningByOrg.delete(orgId)
}

/** For tests only: the process-local counters. */
export function runnerStateForTests() {
  return { inFlight: inFlight.size, running, runningByOrg: new Map(runningByOrg) }
}

/** For tests only: forget everything this process is tracking. */
export function resetRunnerStateForTests(): void {
  inFlight.clear()
  running = 0
  runningByOrg.clear()
}

// --- decisions --------------------------------------------------------------

/**
 * Whether an answer falls inside the sampling rate. Deterministic: the same
 * answer id always decides the same way, so a repeated callback (or a second
 * process seeing the same answer) never flips the decision. A rate of 0 takes
 * nothing, 1 takes everything, and null (unset) takes nothing.
 */
export function isSampled(answerId: string, rate: number | null): boolean {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return false
  if (rate >= 1) return true
  const bucket = parseInt(createHash('sha256').update(answerId).digest('hex').slice(0, 8), 16) / 0x1_0000_0000
  return bucket < rate
}

/** Midnight UTC of the day `now` falls in: the daily limit resets then. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * The first bound an answer runs into, in a fixed order, or null when it may be
 * assessed. When it returns null the caller holds a concurrency slot and must
 * release it. The daily count includes this process's assessments still
 * running, so a burst cannot all pass the same check; across processes the
 * limit can be passed by at most the processes' running assessments.
 */
async function gate(
  job: ScheduleSourceSupportInput,
  settings: SupportSettings,
  now: Date
): Promise<SkipReason | null> {
  if (settings[SURFACE_SWITCH[job.surface]] !== true) return 'disabled'
  if (!isSampled(job.answerId, settings.samplingRate)) return 'not_sampled'
  if (settings.dailyLimit === null || settings.dailyLimit <= 0) return 'over_budget'
  const used = await countSupportAssessmentsSince(job.orgId, startOfUtcDay(now))
  // Checked and reserved in one synchronous step after the await, so two tasks in this process cannot both take the last place.
  if (used + (runningByOrg.get(job.orgId) ?? 0) >= settings.dailyLimit) return 'over_budget'
  if (running >= SUPPORT_MAX_CONCURRENT) return 'over_cap'
  reserveSlot(job.orgId)
  return null
}

// --- recording --------------------------------------------------------------

/** An assessment that never ran: no articles, no usage, and an answer that is not assessed. */
function notRun(execution: Extract<Execution, { state: 'skipped' | 'failed' }>): SupportAssessment {
  return {
    method: { ...SUPPORT_METHOD },
    execution,
    articles: [],
    answer: deriveAnswerSupport(execution, []),
    similarity: { checked: 0, downgraded: 0, unavailable: false, scores: {} },
    usage: { judgeInputTokens: 0, judgeOutputTokens: 0, embeddingTokens: 0 },
    judgeModelId: null,
  }
}

export const skippedAssessment = (reason: SkipReason) => notRun({ state: 'skipped', reason })
export const failedAssessment = (reason: FailReason) => notRun({ state: 'failed', reason })

/** The only fields a runner log line carries: ids, the channel and an error's class. Never question, answer or article text. */
function logFields(job: Pick<ScheduleSourceSupportInput, 'orgId' | 'answerId' | 'surface'>, err?: unknown) {
  return {
    module: MOD,
    orgId: job.orgId,
    answerId: job.answerId,
    surface: job.surface,
    ...(err !== undefined ? { errorClass: err instanceof Error ? err.name : typeof err } : {}),
  }
}

async function record(job: ScheduleSourceSupportInput, assessment: SupportAssessment): Promise<void> {
  const result = await recordSupportAssessment({ orgId: job.orgId, answerId: job.answerId, assessment })
  if (!result.recorded) {
    // already_recorded is the idempotency guard doing its job; the others mean there was no answer row to attach to.
    logger.debug('source support assessment not recorded', { ...logFields(job), reason: result.reason })
  }
}

// --- the embedding call, bounded --------------------------------------------

class EmbedTimeout extends Error {
  constructor() {
    super('embedding timed out')
    this.name = 'EmbedTimeout'
  }
}

/**
 * The similarity check's embedding call, with the same time limit as the judge
 * so a hung provider cannot hold a concurrency slot forever. A timeout reads as
 * "embeddings unavailable", which lowers every support to inconclusive.
 */
function boundedEmbed(
  embedTexts: typeof import('@/lib/ai/embed').embedTexts,
  orgId: number,
  seen: { modelId?: string },
  timeoutMs: number
): EmbedFn {
  return async (texts) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EmbedTimeout()), timeoutMs)
    })
    try {
      const { embeddings, tokens, model } = await Promise.race([embedTexts(texts, orgId), limit])
      seen.modelId = model
      return { embeddings, tokens }
    } finally {
      clearTimeout(timer)
    }
  }
}

// --- the run ----------------------------------------------------------------

type ModelLayer = [typeof import('@/lib/ai/support-judge'), typeof import('@/lib/ai/embed')]
let modelLayer: Promise<ModelLayer> | undefined

/**
 * The judge and embedding modules, loaded on first use rather than at the top:
 * the model layer stays off the call sites' import path, and a failure to load
 * it is caught and recorded like any other. Loaded once per process; a failed
 * load is forgotten so the next assessment tries again.
 */
function loadModelLayer(): Promise<ModelLayer> {
  modelLayer ??= Promise.all([import('@/lib/ai/support-judge'), import('@/lib/ai/embed')]).catch((err) => {
    modelLayer = undefined
    throw err
  })
  return modelLayer
}

/** The inputs as copied at scheduling time; nothing the caller does afterwards reaches them. */
type CapturedJob = Readonly<ScheduleSourceSupportInput>

/**
 * Runs one answer's assessment: reads the switches, applies the bounds in
 * order, assesses, records. Never throws. Exported for tests; production code
 * goes through `scheduleSourceSupport`.
 */
export async function runSourceSupport(
  job: CapturedJob,
  options: { now?: () => Date; timeoutMs?: number } = {}
): Promise<void> {
  let holdsSlot = false
  let recorded = false
  try {
    const settings = await findSupportSettings(job.orgId)
    // Never configured: nothing to record. Its answers have no assessment row,
    // which every count already treats as not assessed, and the workspaces that
    // never opted in pay no write per answer.
    if (!settings) return

    const skip = await gate(job, settings, (options.now ?? (() => new Date()))())
    if (skip) {
      recorded = true
      await record(job, skippedAssessment(skip))
      return
    }
    holdsSlot = true

    const articles: SuppliedArticle[] = job.context.flatMap((c) =>
      c.articleId == null ? [] : [{ id: c.articleId, question: c.summary, answer: c.answer }]
    )
    const snapshot = buildSnapshot({ question: job.question, answer: job.answer, articles })
    const [{ liveJudge, assessmentCostMicros }, { embedTexts }] = await loadModelLayer()
    const timeoutMs = options.timeoutMs ?? JUDGE_TIMEOUT_MS
    const embedding: { modelId?: string } = {}
    const assessment = await assessSupport(snapshot, {
      judge: liveJudge(job.orgId),
      embed: boundedEmbed(embedTexts, job.orgId, embedding, timeoutMs),
      timeoutMs,
    })
    recorded = true
    await record(job, assessment)

    if (assessment.judgeModelId) {
      const cost = assessmentCostMicros(assessment.usage, assessment.judgeModelId, embedding.modelId ?? assessment.judgeModelId)
      if (cost !== null && cost > SUPPORT_COST_CEILING_MICROS) {
        logger.warn('source support assessment cost more than its ceiling', {
          ...logFields(job),
          costMicros: cost,
          ceilingMicros: SUPPORT_COST_CEILING_MICROS,
        })
      }
    }
  } catch (err) {
    logger.warn('source support assessment failed', logFields(job, err))
    if (!recorded) {
      // The run broke before anything was recorded: record it as interrupted so
      // it reads as not assessed with a reason. If this write fails too, the
      // answer simply has no row, which also reads as not assessed.
      try {
        await record(job, failedAssessment('interrupted'))
      } catch (again) {
        logger.warn('source support failure could not be recorded', logFields(job, again))
      }
    }
  } finally {
    if (holdsSlot) releaseSlot(job.orgId)
  }
}

/**
 * Schedules a source-support assessment for one generated answer and returns
 * at once. Call it only after `recordAnswerSources` with outcome `generated`.
 *
 * It copies what it needs from the inputs now (the strings, and each article's
 * id, title and text), so later changes by the caller cannot reach the
 * assessment, and the snapshot is built inside the deferred work so the
 * segmentation never sits on the reply path. It never throws, never awaits
 * anything, and nothing it does can change the reply, its confidence score or
 * auto-deflection. A second call for an answer this process is still handling
 * does nothing; a repeat after that is stopped by the storage's idempotency key.
 *
 * `defer` is injectable so tests can hold the work and check the reply was
 * returned before any of it started.
 */
export function scheduleSourceSupport(input: ScheduleSourceSupportInput, options: { defer?: Defer } = {}): void {
  let added = false
  try {
    if (typeof input.answerId !== 'string' || !UUID.test(input.answerId)) return
    if (inFlight.has(input.answerId)) return
    inFlight.add(input.answerId)
    added = true

    const job: CapturedJob = {
      orgId: input.orgId,
      answerId: input.answerId,
      surface: input.surface,
      question: String(input.question ?? ''),
      answer: String(input.answer ?? ''),
      context: Object.freeze(
        (input.context ?? []).map((c) =>
          Object.freeze({ articleId: c.articleId, summary: String(c.summary ?? ''), answer: String(c.answer ?? '') })
        )
      ),
    }
    const answerId = input.answerId
    const defer = options.defer ?? deferAfterResponse
    defer(() =>
      runSourceSupport(job).finally(() => {
        inFlight.delete(answerId)
      })
    )
  } catch (err) {
    if (added) inFlight.delete(input.answerId)
    try {
      logger.warn('source support could not be scheduled', logFields(input, err))
    } catch {
      // Logging itself failed; there is nothing further to do, and the reply must not notice.
    }
  }
}
