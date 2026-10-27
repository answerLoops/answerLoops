import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { LLMock } from '@copilotkit/aimock'
import { EmptyAIResponseError } from '@/lib/ai/errors'

/**
 * triageMessage and assessAnswer against a real HTTP server standing in for an
 * OpenAI-compatible provider (AIMock, started in this process on a free port).
 *
 * Unlike the tests that replace the agent library, nothing between the app and
 * the wire is faked: the workspace's AI config is resolved to a custom base
 * URL, the request goes out through the app's safe fetch and the AI SDK, and
 * the reply is parsed and validated by the real structured-output code. That is
 * the layer where an empty or malformed completion first shows up.
 *
 * Provider outages (500, 429, a dropped connection) are not exercised here: the
 * AI SDK retries them with backoff, which takes several seconds per case.
 */

const h = vi.hoisted(() => ({ baseUrl: '' }))

vi.mock('@/lib/db/queries/ai-config', () => ({
  getOrgAIConfig: async () => ({
    chat_provider: 'openai-compatible',
    chat_api_key: null,
    chat_base_url: h.baseUrl,
    chat_model: 'mock-model',
    embedding_provider: 'openai-compatible',
    embedding_api_key: null,
    embedding_base_url: h.baseUrl,
    embedding_model: 'mock-embedding',
  }),
}))

const TRIAGE = '{"category":"how_to","severity_score":0.2,"summary":"ok","suggested_priority":"low","reasoning":"r"}'
const assessment = (confidence: number | string, answeredFully: boolean | string) =>
  JSON.stringify({ confidence, answered_fully: answeredFully, reasoning: 'r' })

let mock: LLMock

beforeAll(async () => {
  // Custom endpoints are reachable on the local network only for self-hosted installs.
  vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')

  mock = new LLMock({ port: 0 })

  mock.on({ userMessage: 'CASE_TRIAGE_OK' }, { content: TRIAGE })
  mock.on({ userMessage: 'CASE_TRIAGE_EMPTY' }, { content: '' })
  mock.on({ userMessage: 'CASE_TRIAGE_BAD_CATEGORY' }, { content: TRIAGE.replace('how_to', 'nonsense') })
  mock.on({ userMessage: 'CASE_TRIAGE_MALFORMED' }, { content: TRIAGE }, { chaos: { malformedRate: 1 } })

  mock.on({ userMessage: 'CASE_ASSESS_OK' }, { content: assessment(0.9, true) })
  mock.on({ userMessage: 'CASE_ASSESS_JUST_BELOW' }, { content: assessment(0.79, true) })
  mock.on({ userMessage: 'CASE_ASSESS_AT_THRESHOLD' }, { content: assessment(0.8, true) })
  mock.on({ userMessage: 'CASE_ASSESS_NOT_FULLY' }, { content: assessment(0.95, false) })
  mock.on({ userMessage: 'CASE_ASSESS_EMPTY' }, { content: '' })
  mock.on({ userMessage: 'CASE_ASSESS_NOT_JSON' }, { content: 'I think this answer is great.' })
  mock.on({ userMessage: 'CASE_ASSESS_ABOVE_ONE' }, { content: assessment(1.7, true) })
  mock.on({ userMessage: 'CASE_ASSESS_BELOW_ZERO' }, { content: assessment(-3, true) })
  mock.on({ userMessage: 'CASE_ASSESS_STRING_BOOLEAN' }, { content: assessment(0.95, 'yes') })
  mock.on({ userMessage: 'CASE_ASSESS_MALFORMED' }, { content: assessment(0.9, true) }, { chaos: { malformedRate: 1 } })

  h.baseUrl = `${await mock.start()}/v1`
})

afterAll(async () => {
  await mock.stop()
  vi.unstubAllEnvs()
})

describe('triageMessage over HTTP', () => {
  it('parses a valid reply', async () => {
    const { triageMessage } = await import('@/lib/ai/triage')
    await expect(triageMessage('CASE_TRIAGE_OK how do I reset?', 1)).resolves.toMatchObject({
      category: 'how_to',
      severity_score: 0.2,
    })
  })

  it('rejects with a named error when the reply is empty', async () => {
    const { triageMessage } = await import('@/lib/ai/triage')
    await expect(triageMessage('CASE_TRIAGE_EMPTY how do I reset?', 1)).rejects.toBeInstanceOf(EmptyAIResponseError)
  })

  it('rejects a category outside the allowed set', async () => {
    const { triageMessage } = await import('@/lib/ai/triage')
    await expect(triageMessage('CASE_TRIAGE_BAD_CATEGORY how do I reset?', 1)).rejects.toThrow(/category/)
  })

  it('rejects a reply that is not valid JSON', async () => {
    const { triageMessage } = await import('@/lib/ai/triage')
    await expect(triageMessage('CASE_TRIAGE_MALFORMED how do I reset?', 1)).rejects.toThrow()
  })
})

describe('assessAnswer over HTTP', () => {
  const grade = async (tag: string) => {
    const { assessAnswer } = await import('@/lib/ai/assess')
    return assessAnswer(`${tag} how do I reset?`, 'Open settings.', 1)
  }

  it('parses a valid reply', async () => {
    await expect(grade('CASE_ASSESS_OK')).resolves.toEqual({ confidence: 0.9, answered_fully: true, reasoning: 'r' })
  })

  it('rejects with a named error when the reply is empty', async () => {
    await expect(grade('CASE_ASSESS_EMPTY')).rejects.toBeInstanceOf(EmptyAIResponseError)
  })

  it.each([
    ['text that is not JSON', 'CASE_ASSESS_NOT_JSON'],
    ['a confidence above 1', 'CASE_ASSESS_ABOVE_ONE'],
    ['a confidence below 0', 'CASE_ASSESS_BELOW_ZERO'],
    ['answered_fully that is not a boolean', 'CASE_ASSESS_STRING_BOOLEAN'],
    ['a body that is not valid JSON', 'CASE_ASSESS_MALFORMED'],
  ])('rejects %s', async (_label, tag) => {
    await expect(grade(tag)).rejects.toThrow()
  })

  it('auto-deflects only at or above the threshold, and only when fully answered', async () => {
    const { shouldAutoDeflect } = await import('@/lib/ai/assess')
    expect(shouldAutoDeflect(await grade('CASE_ASSESS_JUST_BELOW'))).toBe(false)
    expect(shouldAutoDeflect(await grade('CASE_ASSESS_AT_THRESHOLD'))).toBe(true)
    expect(shouldAutoDeflect(await grade('CASE_ASSESS_NOT_FULLY'))).toBe(false)
  })
})
