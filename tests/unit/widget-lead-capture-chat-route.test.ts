import { describe, it, expect, vi, beforeEach } from 'vitest'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * Covers the lead-signal computation added to runWidgetAgent's onFinish in
 * app/api/widget/chat/route.ts (see lib/widget/lead-capture.ts's requestsHuman
 * and lib/widget/lead-signal-stash.ts's setLeadSignal, read back later by
 * app/api/widget/lead-signal/route.ts — covered separately in
 * widget-lead-signal-route.test.ts).
 *
 * The route has no plain POST export to call directly — it's a CopilotKit
 * single-route handler (createCopilotRuntimeHandler) backed by a
 * runWidgetAgent factory that CopilotKit itself invokes — so this drives the
 * whole POST handler the same way tests/unit/widget-chat-route-behavior.test.ts
 * and tests/unit/widget-kb-only-context.test.ts do: a fake Mastra Agent whose
 * stream() calls the route's real onFinish callback.
 *
 * lib/kb/review-capture.ts's captureUnansweredQuestion and
 * lib/kb/usage.ts's countArticleUsage/recordAnswerSources are deliberately
 * left unmocked, matching widget-chat-route-behavior.test.ts: both wrap their
 * DB calls in try/catch and swallow failures, so they run for real here
 * against no database and fail silently without affecting the outcome under
 * test — only lib/widget/lead-signal-stash's setLeadSignal is mocked, since
 * that's what's actually being asserted on.
 */

const VALID_TOKEN = 'e'.repeat(48)

const h = vi.hoisted(() => ({
  reserveGeneration: vi.fn(async () => ({ granted: true, generationId: 1 })),
  getOrgByWidgetToken: vi.fn(async () => ({ id: 7, name: 'Acme', widget_token: VALID_TOKEN })),
  getKBContext: vi.fn(async () => [] as { summary: string; answer: string; articleId?: number }[]),
  setLeadSignal: vi.fn(),
}))

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
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
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: h.getKBContext }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/widget/lead-signal-stash', () => ({ setLeadSignal: h.setLeadSignal }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(_query: string, options?: { onFinish?: (event?: { text?: string }) => void | Promise<void> }) {
      await options?.onFinish?.(undefined)
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

async function ask(question: string, visitorId = 'v1') {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(
    widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId, messages: [userMsg(question)] })
  )
  await drain(res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 1 })
  h.getOrgByWidgetToken.mockResolvedValue({ id: 7, name: 'Acme', widget_token: VALID_TOKEN })
  h.getKBContext.mockResolvedValue([])
})

describe('widget chat route onFinish: lead signal', () => {
  it('stashes "no-kb-match" when the KB context came back empty and no human was requested', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('how do I reset my password?', 'visitor-1')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledTimes(1)
    expect(h.setLeadSignal).toHaveBeenCalledWith(7, 'visitor-1', 'no-kb-match')
  })

  it('stashes "none" when KB context was found and no human was requested', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('how do I install this?', 'visitor-2')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(7, 'visitor-2', 'none')
  })

  it('stashes "human-requested" even when KB context was found, taking priority over a clean answer', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('can you connect me with a representative', 'visitor-3')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(7, 'visitor-3', 'human-requested')
  })

  it('stashes "human-requested" when KB context was empty too, taking priority over "no-kb-match"', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('please transfer me to a representative', 'visitor-4')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(7, 'visitor-4', 'human-requested')
  })

  it('scopes the stashed signal to the org and visitor from this request', async () => {
    h.getOrgByWidgetToken.mockResolvedValue({ id: 42, name: 'Other Org', widget_token: VALID_TOKEN })
    h.getKBContext.mockResolvedValue([])
    await ask('any question', 'visitor-xyz')
    expect(h.setLeadSignal).toHaveBeenCalledWith(42, 'visitor-xyz', 'no-kb-match')
  })
})
