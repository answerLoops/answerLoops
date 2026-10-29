import { JUDGE_INSTRUCTIONS, buildJudgePrompt } from './prompt'
import { JUDGE_TIMEOUT_MS, SUPPORT_METHOD } from './method'
import { confirmSupports, type EmbedFn } from './similarity'
import { transition, type Execution, type FailReason } from './state'
import { hasWorkForJudge, type SupportSnapshot } from './snapshot'
import { deriveAnswerSupport, deriveArticleSupport, type ArticleSupport, type SupportSummary } from './summary'
import { validateJudgeOutput, type ValidationResult } from './validate'

/** What one judge call returned. `raw` is whatever the model produced, untrusted until validated. */
export interface JudgeResult {
  raw?: unknown
  usage?: { inputTokens: number; outputTokens: number }
  /** The model that answered, recorded with the finding. */
  modelId?: string
}

export type JudgeFn = (call: { instructions: string; prompt: string }) => Promise<JudgeResult>

export interface AssessDeps {
  judge: JudgeFn
  embed: EmbedFn
  /** Overrides the method's floor; used by the evaluation to sweep it. */
  floor?: number
  timeoutMs?: number
}

export interface SupportAssessment {
  method: { method: string; version: number; rubric: number; similarityFloor: number; floorCalibrated: boolean }
  execution: Execution
  /** What survived validation and the similarity check; absent when nothing was judged. */
  validation?: ValidationResult
  articles: ArticleSupport[]
  answer: SupportSummary
  similarity: { checked: number; downgraded: number; unavailable: boolean; scores: Record<string, number> }
  usage: { judgeInputTokens: number; judgeOutputTokens: number; embeddingTokens: number }
  judgeModelId: string | null
}

class JudgeTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JudgeTimeout('judge timed out')), ms)
  })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

function finish(
  snapshot: SupportSnapshot,
  execution: Execution,
  extra: Partial<Pick<SupportAssessment, 'validation' | 'similarity' | 'usage' | 'judgeModelId'>> = {}
): SupportAssessment {
  const articles = deriveArticleSupport(snapshot, { execution, validation: extra.validation })
  return {
    method: { ...SUPPORT_METHOD },
    execution,
    validation: extra.validation,
    articles,
    answer: deriveAnswerSupport(execution, articles),
    similarity: extra.similarity ?? { checked: 0, downgraded: 0, unavailable: false, scores: {} },
    usage: extra.usage ?? { judgeInputTokens: 0, judgeOutputTokens: 0, embeddingTokens: 0 },
    judgeModelId: extra.judgeModelId ?? null,
  }
}

/**
 * Assesses one answer against its supplied articles: one judge call covering
 * every article, validation against the snapshot, the similarity check on every
 * support, then the derived states. It never throws. Whatever goes wrong ends
 * as a failed or skipped execution (not assessed) or a rejected output
 * (inconclusive), and never as supporting or no support.
 *
 * It holds no state and stores nothing: the caller records the result.
 */
export async function assessSupport(snapshot: SupportSnapshot, deps: AssessDeps): Promise<SupportAssessment> {
  let execution: Execution = { state: 'not_scheduled' }

  if (snapshot.claims.length === 0) {
    return finish(snapshot, transition(execution, { type: 'skip', reason: 'no_claims' }).execution)
  }

  execution = transition(transition(execution, { type: 'schedule' }).execution, { type: 'start' }).execution

  // An answer given no articles has nothing to check against; there is no call to make.
  if (!hasWorkForJudge(snapshot)) {
    return finish(snapshot, transition(execution, { type: 'complete' }).execution, { validation: { ok: true, findings: [], offTopic: [] } })
  }

  const failed = (reason: FailReason) => finish(snapshot, transition(execution, { type: 'fail', reason }).execution)

  let judged
  try {
    judged = await withTimeout(
      deps.judge({ instructions: JUDGE_INSTRUCTIONS, prompt: buildJudgePrompt(snapshot) }),
      deps.timeoutMs ?? JUDGE_TIMEOUT_MS
    )
  } catch (err) {
    return failed(err instanceof JudgeTimeout ? 'timeout' : 'provider_error')
  }

  const usage = {
    judgeInputTokens: judged.usage?.inputTokens ?? 0,
    judgeOutputTokens: judged.usage?.outputTokens ?? 0,
    embeddingTokens: 0,
  }
  const validation = validateJudgeOutput(snapshot, judged.raw)
  if (!validation.ok && validation.kind === 'no_result') return failed('no_result')

  const done = transition(execution, { type: 'complete' }).execution
  if (!validation.ok) return finish(snapshot, done, { validation, usage, judgeModelId: judged.modelId ?? null })

  const floor = deps.floor ?? SUPPORT_METHOD.similarityFloor
  const check = await confirmSupports(snapshot, validation.findings, deps.embed, floor)
  return finish(snapshot, done, {
    validation: { ...validation, findings: check.findings },
    similarity: {
      checked: check.checked,
      downgraded: check.downgraded,
      unavailable: check.unavailable,
      scores: Object.fromEntries(check.scores),
    },
    usage: { ...usage, embeddingTokens: check.tokens },
    judgeModelId: judged.modelId ?? null,
  })
}
