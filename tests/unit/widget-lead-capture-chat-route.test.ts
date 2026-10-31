import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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
  getOrgByWidgetToken: vi.fn(async () => ({
    id: 7,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    widget_lead_capture_mode: 'on-failure',
  })),
  getKBContext: vi.fn(async () => [] as { summary: string; answer: string; articleId?: number }[]),
  setLeadSignal: vi.fn(),
  clearLeadSignal: vi.fn(),
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
vi.mock('@/lib/widget/lead-signal-stash', () => ({
  setLeadSignal: h.setLeadSignal,
  clearLeadSignal: h.clearLeadSignal,
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(_query: string, options?: { onFinish?: (event?: { text?: string }) => void | Promise<void> }) {
      await options?.onFinish?.(undefined)
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

async function ask(question: string, visitorId = 'v1', sessionId: unknown = 'tab-1') {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(
    widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId, sessionId, messages: [userMsg(question)] })
  )
  await drain(res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 1 })
  h.getOrgByWidgetToken.mockResolvedValue({
    id: 7,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    widget_lead_capture_mode: 'on-failure',
  })
  h.getKBContext.mockResolvedValue([])
})

describe('widget chat route onFinish: lead signal', () => {
  it('stashes "no-kb-match" when the KB context came back empty and no human was requested', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('how do I reset my password?', 'visitor-1')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledTimes(1)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-1', 'tab-1', 'no-kb-match')
  })

  it('stashes "none" when KB context was found and no human was requested', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('how do I install this?', 'visitor-2')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-2', 'tab-1', 'none')
  })

  it('stashes "human-requested" even when KB context was found, taking priority over a clean answer', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('can you connect me with a representative', 'visitor-3')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-3', 'tab-1', 'human-requested')
  })

  it('stashes "human-requested" when KB context was empty too, taking priority over "no-kb-match"', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('please transfer me to a representative', 'visitor-4')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-4', 'tab-1', 'human-requested')
  })

  it('scopes the stashed signal to the widget token, visitor and tab from this request', async () => {
    h.getKBContext.mockResolvedValue([])
    await ask('any question', 'visitor-xyz', 'tab-77')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-xyz', 'tab-77', 'no-kb-match')
  })

  it('falls into a shared "legacy" scope when the page sent no valid session id', async () => {
    h.getKBContext.mockResolvedValue([])
    await ask('any question', 'visitor-old', null)
    await ask('any question', 'visitor-bad', 'has:colon')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-old', 'legacy', 'no-kb-match')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-bad', 'legacy', 'no-kb-match')
  })

  it('stashes nothing for a workspace that is not in on-failure mode', async () => {
    h.getKBContext.mockResolvedValue([])
    for (const mode of ['off', 'up-front']) {
      h.getOrgByWidgetToken.mockResolvedValue({
        id: 7,
        name: 'Acme',
        widget_token: VALID_TOKEN,
        widget_lead_capture_mode: mode,
      })
      const res = await ask('how do I reset my password?', 'visitor-mode')
      expect(res.status, mode).toBe(200)
      expect(h.setLeadSignal, mode).not.toHaveBeenCalled()
    }
  })

  it('does not stash "no-kb-match" for a bare greeting or acknowledgement with no KB match', async () => {
    h.getKBContext.mockResolvedValue([])
    for (const greeting of ['hi', 'Hello!', 'thanks', 'ok cool']) {
      h.setLeadSignal.mockClear()
      await ask(greeting, 'visitor-greet')
      expect(h.setLeadSignal, greeting).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-greet', 'tab-1', 'none')
    }
  })

  it('still stashes "no-kb-match" for a real short question that happens to find nothing', async () => {
    // Confirms the greeting check is anchored to the whole message, not a
    // blanket "short messages don't count" rule — a real miss should still
    // surface the prompt regardless of length.
    h.getKBContext.mockResolvedValue([])
    await ask('pricing?', 'visitor-short-q')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-short-q', 'tab-1', 'no-kb-match')
  })
})

describe('widget chat route: clears the previous turn\'s signal before this run can fail', () => {
  it('calls clearLeadSignal for this token+visitor+tab, before the run can produce its own result', async () => {
    h.getKBContext.mockResolvedValue([])
    await ask('how do I reset my password?', 'visitor-9', 'tab-3')
    expect(h.clearLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-9', 'tab-3')
    // Must happen before setLeadSignal (onFinish), not after — the whole
    // point is to clear stale state ahead of this run's own outcome, not
    // wipe out the result this same run just wrote.
    const clearOrder = h.clearLeadSignal.mock.invocationCallOrder[0]
    const setOrder = h.setLeadSignal.mock.invocationCallOrder[0]
    expect(clearOrder).toBeLessThan(setOrder)
  })

  it('still clears when the run is then turned away before the workspace is even looked up', async () => {
    // An org-level 404 and a quota refusal both return before any answer is
    // produced; the previous turn's result must already be gone by then.
    h.getOrgByWidgetToken.mockResolvedValue(null as never)
    const res = await ask('anything', 'visitor-rejected', 'tab-5')
    expect(res.status).toBe(404)
    expect(h.clearLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-rejected', 'tab-5')
    expect(h.setLeadSignal).not.toHaveBeenCalled()
  })

  it('does not clear anything for a request whose visitor id is invalid', async () => {
    const res = await ask('anything', 'has space', 'tab-5')
    expect(res.status).toBe(400)
    expect(h.clearLeadSignal).not.toHaveBeenCalled()
  })
})

describe('widget chat route: the signal is written before the slower onFinish work', () => {
  it('calls setLeadSignal before commitDeflection, so a slow or failing downstream step cannot delay or skip it', () => {
    // Behavioral proof lives in the tests above (setLeadSignal always lands,
    // even against a mocked commitDeflection/countArticleUsage/etc. that just
    // resolve normally in this harness); this is the source-order guarantee
    // those behavioral tests can't see on their own. Ordering by text index
    // rather than a fixed-size slice — see the fix to the similar brittle
    // check in tests/unit/deflection-quota-gaps.test.ts.
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/widget/chat/route.ts'), 'utf-8')
    const onFinishIdx = src.indexOf('onFinish: async (event) => {')
    const setSignalIdx = src.indexOf('setLeadSignal(', onFinishIdx)
    const commitIdx = src.indexOf('commitDeflection(org.id, reservationId)', onFinishIdx)
    expect(onFinishIdx).toBeGreaterThan(-1)
    expect(setSignalIdx).toBeGreaterThan(onFinishIdx)
    expect(commitIdx).toBeGreaterThan(onFinishIdx)
    expect(setSignalIdx).toBeLessThan(commitIdx)
  })
})
