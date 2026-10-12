import { describe, it, expect, vi, beforeEach } from 'vitest'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * Behavioural coverage of the review-queue hook in the widget chat route's
 * onFinish: capture only when retrieval found nothing, never carry visitor
 * identity, and never let a capture problem break the delivered answer or the
 * deflection billing that runs before it.
 */

const VALID_TOKEN = 'c'.repeat(48)

const h = vi.hoisted(() => ({
  reserveGeneration: vi.fn(),
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
  rateLimitShared: vi.fn(),
  getOrgByWidgetToken: vi.fn(),
  embedText: vi.fn(),
  getKBContext: vi.fn(),
  capture: vi.fn(async () => {}),
  finishEvent: undefined as unknown,
}))

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  releaseGeneration: h.releaseGeneration,
  commitDeflection: h.commitDeflection,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({ id: 'fake-model' })),
  DEFAULT_FAST_MODEL: 'fake-model',
  NoAIProviderConfiguredError: class extends Error {},
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: () => true }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ai/embed', () => ({ embedText: h.embedText }))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: h.getKBContext }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/kb/review-capture', () => ({ captureUnansweredQuestion: h.capture }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(_q: string, options?: { onFinish?: (e?: unknown) => void | Promise<void> }) {
      await options?.onFinish?.(h.finishEvent)
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

async function callRoute(query = 'does it support dark mode?') {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId: 'visitor-1', messages: [userMsg(query)] }))
  await drain(res)
  return res
}

beforeEach(async () => {
  vi.clearAllMocks()
  const { clearEmbedQueryCache } = await import('@/lib/widget/embed-cache')
  clearEmbedQueryCache()
  h.finishEvent = { text: 'General knowledge reply.' }
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.getOrgByWidgetToken.mockResolvedValue({ id: 88, name: 'Acme', widget_token: VALID_TOKEN })
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 4 })
  h.embedText.mockResolvedValue([0.1, 0.2])
  h.getKBContext.mockResolvedValue([])
  h.capture.mockResolvedValue(undefined)
})

describe('widget chat onFinish: review-queue capture', () => {
  it('captures the question and streamed text for the right org when no article matched', async () => {
    const res = await callRoute('does it support dark mode?')
    expect(res.status).toBe(200)
    expect(h.capture).toHaveBeenCalledTimes(1)
    const arg = (h.capture.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg).toMatchObject({
      orgId: 88,
      source: 'widget',
      question: 'does it support dark mode?',
      answer: 'General knowledge reply.',
    })
    expect(arg.embedding).toEqual([0.1, 0.2])
    expect(JSON.stringify(arg)).not.toContain('visitor-1')
  })

  it('does not capture when the KB returned context for the question', async () => {
    h.getKBContext.mockResolvedValue([{ id: 1, question: 'Dark mode?', answer: 'Yes.', similarity: 0.9 }])
    const res = await callRoute()
    expect(res.status).toBe(200)
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('bills the deflection before attempting the capture', async () => {
    const order: string[] = []
    h.commitDeflection.mockImplementationOnce(async () => {
      order.push('commit')
    })
    h.capture.mockImplementationOnce(async () => {
      order.push('capture')
    })
    await callRoute()
    expect(order).toEqual(['commit', 'capture'])
  })

  it('passes an empty answer when the stream finished without text', async () => {
    h.finishEvent = undefined
    await callRoute()
    expect((h.capture.mock.calls[0] as unknown[])[0]).toMatchObject({ answer: '' })
  })

  it('still captures (without an embedding) when the query embedding fails', async () => {
    h.embedText.mockRejectedValue(new Error('embedding provider down'))
    await callRoute()
    expect(h.capture).toHaveBeenCalledTimes(1)
    expect((h.capture.mock.calls[0] as unknown[])[0]).toMatchObject({ orgId: 88, embedding: undefined })
  })
})
