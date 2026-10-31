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
  getOrgByWidgetToken: vi.fn(
    async (): Promise<{
      id: number
      name: string
      widget_token: string
      widget_lead_capture_mode: string
    } | null> => ({
      id: 7,
      name: 'Acme',
      widget_token: VALID_TOKEN,
      widget_lead_capture_mode: 'on-failure',
    })
  ),
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
vi.mock('@/lib/widget/lead-signal-stash', () => ({
  setLeadSignal: h.setLeadSignal,
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(_query: string, options?: { onFinish?: (event?: { text?: string }) => void | Promise<void> }) {
      await options?.onFinish?.(undefined)
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

async function ask(question: string, visitorId = 'v1', turnId: unknown = 'turn-1') {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(
    widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId, turnId, messages: [userMsg(question)] })
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
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-1', 'turn-1', 'no-kb-match', expect.any(String))
  })

  it('stashes "none" when KB context was found and no human was requested', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('how do I install this?', 'visitor-2')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-2', 'turn-1', 'none', expect.any(String))
  })

  it('stashes "human-requested" even when KB context was found, taking priority over a clean answer', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('can you connect me with a representative', 'visitor-3')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-3', 'turn-1', 'human-requested', expect.any(String))
  })

  it('stashes "human-requested" when KB context was empty too, taking priority over "no-kb-match"', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('please transfer me to a representative', 'visitor-4')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-4', 'turn-1', 'human-requested', expect.any(String))
  })

  it('stashes "human-requested" for "connect me to an agent" — aimed at the visitor, so it is a request for a person', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'API', answer: 'Use the REST API' }])
    const res = await ask('connect me to an agent', 'visitor-me')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-me', 'turn-1', 'human-requested', expect.any(String))
  })

  it('does not match "connect to an agent" API-style phrasing as a request for a human', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'API', answer: 'Use the REST API' }])
    const res = await ask('how do I connect to an agent through the API', 'visitor-api')
    expect(res.status).toBe(200)
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-api', 'turn-1', 'none', expect.any(String))
  })

  it('records the visitor\'s own message with the signal, under this turn\'s id', async () => {
    h.getKBContext.mockResolvedValue([])
    await ask('how do I export my data?', 'visitor-xyz', 'turn-77')
    expect(h.setLeadSignal).toHaveBeenCalledWith(
      VALID_TOKEN,
      'visitor-xyz',
      'turn-77',
      'no-kb-match',
      'how do I export my data?'
    )
  })

  it('falls into a shared "legacy" turn id when the page sent none or a malformed one', async () => {
    h.getKBContext.mockResolvedValue([])
    await ask('any question', 'visitor-old', null)
    await ask('any question', 'visitor-bad', 'has:colon')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-old', 'legacy', 'no-kb-match', 'any question')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-bad', 'legacy', 'no-kb-match', 'any question')
  })

  it('records nothing for a workspace that is not in on-failure mode', async () => {
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
    for (const greeting of ['hi', 'Hello!', 'thanks', 'ok cool', 'good morning', 'no thanks', 'thank you so much']) {
      h.setLeadSignal.mockClear()
      await ask(greeting, 'visitor-greet')
      expect(h.setLeadSignal, greeting).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-greet', 'turn-1', 'none', expect.any(String))
    }
  })

  it('still stashes "no-kb-match" for a real short question that happens to find nothing', async () => {
    // Confirms the greeting check is anchored to the whole message, not a
    // blanket "short messages don't count" rule — a real miss should still
    // surface the prompt regardless of length.
    h.getKBContext.mockResolvedValue([])
    await ask('pricing?', 'visitor-short-q')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-short-q', 'turn-1', 'no-kb-match', expect.any(String))
  })
})

describe('widget chat route: a turn that never answers leaves no signal behind', () => {
  // The signal is keyed by turn id, so there is nothing to clear: a request
  // turned away before the run (bad token, rate limit, missing org) simply
  // never records an entry, and no later turn's id can address an earlier
  // turn's entry.
  it('records nothing when the workspace cannot be found (404)', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    const { POST } = await import('@/app/api/widget/chat/route')
    const res = await POST(
      widgetChatRequest({
        widgetToken: VALID_TOKEN,
        visitorId: 'visitor-404',
        turnId: 'turn-404',
        messages: [userMsg('anything')],
      })
    )
    await drain(res)
    expect(res.status).toBe(404)
    expect(h.setLeadSignal).not.toHaveBeenCalled()
  })

  it('has no call that clears a stored signal, so an unauthenticated request cannot wipe a pending one', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/widget/chat/route.ts'), 'utf-8')
    expect(src).not.toMatch(/clearLeadSignal/)
    expect(src.match(/setLeadSignal\(/g)?.length).toBe(1)
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
