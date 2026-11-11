import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Source-shape checks on where the source-support runner is called from, in
// the style of kb-answer-sources-wiring.test.ts: each of the four answer
// surfaces schedules it exactly once, only after recording the answer as
// generated, never awaited and never returned, and never on a failed answer.
// The behaviour behind the call (reply first, never throws) is covered in
// kb-support-runner.test.ts.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

const SITES = [
  { file: 'lib/ai/agent.ts', surface: 'ticket', generated: "surface: 'ticket', outcome: 'generated'", failed: "surface: 'ticket', outcome: 'failed'" },
  { file: 'app/api/widget/chat/route.ts', surface: 'widget', generated: "surface: 'widget', outcome: 'generated'", failed: "surface: 'widget', outcome: 'failed'" },
  { file: 'app/api/slash/ask/route.ts', surface: 'discord', generated: "surface: 'discord', outcome: 'generated'", failed: "surface: 'discord', outcome: 'failed'" },
  { file: 'lib/agent/core.ts', surface: 'agent_api', generated: "surface: 'agent_api', outcome: 'generated'", failed: "surface: 'agent_api', outcome: 'failed'" },
] as const

describe.each(SITES)('$file', ({ file, surface, generated, failed }) => {
  const s = read(file)
  const call = s.indexOf('scheduleSourceSupport({')

  it('imports the scheduler from the server-side runner, not the pure index', () => {
    expect(s).toMatch(/import \{[^}]*\bscheduleSourceSupport\b[^}]*\} from '@\/lib\/kb\/support\/runner'/)
    expect(s).not.toMatch(/from '@\/lib\/kb\/support'\s*$/m)
  })

  it('schedules it exactly once, for its own surface', () => {
    expect(s.match(/scheduleSourceSupport\(\{/g)).toHaveLength(1)
    const args = s.slice(call, s.indexOf('})', call))
    expect(args).toContain(`surface: '${surface}'`)
    expect(args).toMatch(/answerId/)
    expect(args).toMatch(/question/)
    expect(args).toMatch(/answer/)
    expect(args).toMatch(/context/)
  })

  it('never awaits, returns or chains the call into the reply path', () => {
    expect(s).not.toMatch(/await\s+scheduleSourceSupport/)
    expect(s).not.toMatch(/return\s+scheduleSourceSupport/)
    expect(s).not.toMatch(/scheduleSourceSupport\([\s\S]*?\)\s*\.then/)
    expect(s).not.toMatch(/=\s*scheduleSourceSupport/)
  })

  it('comes after the answer was recorded as generated', () => {
    expect(s.indexOf(generated)).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(s.indexOf(generated))
  })

  it('is not on the failed path', () => {
    const failedAt = s.indexOf(failed)
    expect(failedAt).toBeGreaterThan(-1)
    // The scheduled call is not within the statement block that records a failure.
    const failedBlockStart = s.lastIndexOf('{', failedAt)
    const failedStatementEnd = s.indexOf('\n', failedAt)
    expect(call < failedBlockStart || call > failedStatementEnd).toBe(true)
    expect(s.slice(failedBlockStart, failedStatementEnd)).not.toContain('scheduleSourceSupport')
  })
})

describe('the ticket draft schedules after the reply has gone out', () => {
  const s = read('lib/ai/agent.ts')
  const call = s.indexOf('scheduleSourceSupport({')

  it('after the auto-deflect post and the hold-for-review branch, so the reply is never behind it', () => {
    expect(call).toBeGreaterThan(s.indexOf("logger.info('auto-deflected'"))
    expect(call).toBeGreaterThan(s.indexOf('routed to human review — draft held for approval'))
  })

  it('after confidence and auto-deflection were decided, and it cannot feed into them', () => {
    expect(call).toBeGreaterThan(s.indexOf('const autoDeflect = wantsAutoDeflect'))
    expect(call).toBeGreaterThan(s.indexOf('assessment = await assessAnswer('))
  })

  it('passes the draft text and the context the draft was written from', () => {
    expect(s).toContain("scheduleSourceSupport({ orgId, answerId, surface: 'ticket', question, answer: text, context: priorAnswers })")
  })
})

describe('the widget schedules inside onFinish, beside the generated record', () => {
  const s = read('app/api/widget/chat/route.ts')

  it('is inside onFinish and not inside onError', () => {
    const call = s.indexOf('scheduleSourceSupport({')
    expect(call).toBeGreaterThan(s.indexOf('onFinish: async'))
    expect(s.slice(s.indexOf('onError: async'), s.indexOf('onFinish: async'))).not.toContain('scheduleSourceSupport')
  })

  it('assesses the reply the visitor got, against the context the model was given', () => {
    const call = s.indexOf('scheduleSourceSupport({')
    const args = s.slice(call, s.indexOf('})', call))
    expect(args).toContain("answer: typeof event?.text === 'string' ? event.text : ''")
    expect(args).toContain('question: query')
    expect(args).toContain('context: allContext')
  })
})

describe('Discord /ask keeps the article text in memory only for the check', () => {
  const s = read('app/api/slash/ask/route.ts')

  it('records the answer sources with ids only, and hands the text only to the scheduler', () => {
    expect(s).toContain("recordAnswerSources({ orgId, answerId, surface: 'discord', outcome: 'generated', context: kbArticleIds })")
    expect(s).toContain("scheduleSourceSupport({ orgId, answerId, surface: 'discord', question, answer: text, context: kbSupplied })")
  })

  it('schedules before returning the reply, which stays the same response', () => {
    const call = s.indexOf('scheduleSourceSupport({')
    const reply = s.indexOf('return Response.json({ answer: text })')
    expect(call).toBeGreaterThan(-1)
    expect(reply).toBeGreaterThan(call)
  })
})

describe('the Agent API schedules before grading and cannot affect it', () => {
  const s = read('lib/agent/core.ts')

  it('passes the generated text and the grounding context', () => {
    expect(s).toContain("scheduleSourceSupport({ orgId, answerId, surface: 'agent_api', question, answer: text, context: groundingContext })")
  })

  it('the confidence step still grades with the same sources as before', () => {
    expect(s).toContain('const assessment = await assessAnswer(question, text, orgId, gradingSources)')
  })
})
