import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * What runWidgetAgent's onFinish (app/api/widget/chat/route.ts) holds for the
 * widget's post-turn lookup so a visitor can flag the answer just given: the
 * recorded answer id with the question and the reply, only for a workspace on a
 * plan with the Review queue, and written before the slower onFinish work. The
 * harness is the one widget-lead-capture-chat-route.test.ts uses: the whole
 * POST handler, with a fake Mastra Agent whose stream() calls the real onFinish.
 */

const VALID_TOKEN = 'e'.repeat(48)
const REPLY = 'Open Settings and choose Export.'

const h = vi.hoisted(() => ({
  orgHasFeature: vi.fn(async (_orgId: number, _feature: string) => true),
  setLeadSignal: vi.fn(),
  setTurnAnswer: vi.fn(),
  getWidgetKBContext: vi.fn(async () => ({ articles: [] as { summary: string; answer: string; articleId?: number }[], matched: false })),
}))

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: vi.fn(async () => ({ granted: true, generationId: 1 })),
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({
  getOrgByWidgetToken: vi.fn(async () => ({
    id: 7,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    widget_lead_capture_mode: 'off',
  })),
}))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({ id: 'fake-model' })),
  DEFAULT_FAST_MODEL: 'fake-model',
  NoAIProviderConfiguredError: class extends Error {},
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: () => true }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: vi.fn(async () => ({ embedding: [0.1], model: 'test-embed-model' })),
}))
vi.mock('@/lib/ai/embedding-pin', () => ({ getPinnedModel: async () => 'test-embed-model' }))
vi.mock('@/lib/db/queries/kb', () => ({ getWidgetKBContext: h.getWidgetKBContext }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/widget/lead-signal-stash', () => ({
  setLeadSignal: h.setLeadSignal,
  setTurnAnswer: h.setTurnAnswer,
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(_query: string, options?: { onFinish?: (event?: { text?: string }) => void | Promise<void> }) {
      await options?.onFinish?.({ text: REPLY })
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

async function ask(question: string, visitorId = 'v1', turnId: unknown = 'turn-1') {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId, turnId, messages: [userMsg(question)] }))
  await drain(res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.orgHasFeature.mockResolvedValue(true)
  h.getWidgetKBContext.mockResolvedValue({ articles: [], matched: false })
})

describe('widget chat route onFinish: the answer held for flagging', () => {
  it('holds the answer id, the question and the reply under this turn when the plan has the Review queue', async () => {
    await ask('how do I export my data?', 'visitor-1', 'turn-9')
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'kb_review_queue')
    expect(h.setTurnAnswer).toHaveBeenCalledTimes(1)
    expect(h.setTurnAnswer).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-1', 'turn-9', {
      answerId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      question: 'how do I export my data?',
      answer: REPLY,
    })
  })

  it('holds nothing for a workspace whose plan does not have the Review queue', async () => {
    h.orgHasFeature.mockImplementation(async (_id: number, feature: string) => feature !== 'kb_review_queue')
    await ask('how do I export my data?')
    expect(h.setTurnAnswer).not.toHaveBeenCalled()
  })

  it('holds nothing, and still answers, when the plan lookup fails', async () => {
    h.orgHasFeature.mockImplementation(async (_id: number, feature: string) => {
      if (feature === 'kb_review_queue') throw new Error('database unavailable')
      return true
    })
    const res = await ask('how do I export my data?')
    expect(res.status).toBe(200)
    expect(h.setTurnAnswer).not.toHaveBeenCalled()
  })

  it('does not change what the lead-capture signal holds', async () => {
    await ask('how do I export my data?')
    // This workspace is not in on-failure mode, so no lead signal, with or without the answer.
    expect(h.setLeadSignal).not.toHaveBeenCalled()
  })

  it('is written before the slower onFinish work, since the widget\'s lookup arrives as soon as the stream closes', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/widget/chat/route.ts'), 'utf-8')
    const onFinishIdx = src.indexOf('onFinish: async (event) => {')
    const holdIdx = src.indexOf('setTurnAnswer(widgetToken', onFinishIdx)
    const commitIdx = src.indexOf('commitDeflection(org.id, reservationId)', onFinishIdx)
    expect(onFinishIdx).toBeGreaterThan(-1)
    expect(holdIdx).toBeGreaterThan(onFinishIdx)
    expect(holdIdx).toBeLessThan(commitIdx)
  })

  it('checks the plan beside retrieval, not as a separate wait before the answer', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/widget/chat/route.ts'), 'utf-8')
    const promiseAll = src.indexOf('await Promise.all([', src.indexOf('async function runWidgetAgent'))
    const planCheck = src.indexOf("orgHasFeature(org.id, 'kb_review_queue')")
    const closing = src.indexOf('])', promiseAll)
    expect(promiseAll).toBeGreaterThan(-1)
    expect(planCheck).toBeGreaterThan(promiseAll)
    expect(planCheck).toBeLessThan(closing)
  })
})
