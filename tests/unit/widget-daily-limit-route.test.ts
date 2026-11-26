import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/widget/chat/route'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * The per-workspace daily limit in app/api/widget/chat/route.ts: the owner's
 * own limit (never above the instance ceiling) is the daily counter's maximum,
 * the owner is emailed exactly when the day's count reaches 80% of it and when
 * it reaches it, an answer over the limit gets 429, and the email never holds
 * up or breaks the visitor's answer.
 */

const VALID_TOKEN = '0a'.repeat(24)

const h = vi.hoisted(() => ({
  reserveGeneration: vi.fn(),
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
  rateLimitShared: vi.fn(),
  getOrgByWidgetToken: vi.fn(),
  chatModel: vi.fn(),
  sendWidgetDailyLimitEmail: vi.fn(),
  dayResult: { ok: true, count: 1 } as { ok: boolean; count: number },
  hourResult: { ok: true, count: 1 } as { ok: boolean; count: number },
  streamCalls: 0,
}))

const FakeNoProviderError = vi.hoisted(() => class extends Error {})

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  releaseGeneration: h.releaseGeneration,
  commitDeflection: h.commitDeflection,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/email/send', () => ({ sendWidgetDailyLimitEmail: h.sendWidgetDailyLimitEmail }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: h.chatModel,
  DEFAULT_FAST_MODEL: 'fake-model',
  NoAIProviderConfiguredError: FakeNoProviderError,
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: () => true }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn(async () => [0.1]) }))
vi.mock('@/lib/db/queries/kb', () => ({ getWidgetKBContext: vi.fn(async () => ({ articles: [], matched: false })) }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  getPriorAnswers: vi.fn(async () => []),
  getCandidateVectors: vi.fn(async () => []),
}))
vi.mock('@/lib/ai/related', () => ({ findRelated: () => [] }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(_query: string, options?: { onFinish?: () => void | Promise<void> }) {
      h.streamCalls++
      await options?.onFinish?.()
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

function orgWithLimit(limit: number | null) {
  return {
    id: 42,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    widget_slug: null,
    plan_id: 'starter',
    widget_allowed_origins: null,
    widget_daily_answer_limit: limit,
  }
}

function ask() {
  return POST(widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('how do I install?')] }))
}

/** The max the route passed for the workspace's daily counter. */
function dailyMax(): number | undefined {
  const call = h.rateLimitShared.mock.calls.find(([key]) => key === 'widget-org-day:42')
  return call?.[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const name of [
    'WIDGET_LIMIT_PER_WORKSPACE_PER_DAY',
    'WIDGET_LIMIT_PER_WORKSPACE_PER_HOUR',
    'WIDGET_LIMIT_PER_ADDRESS_PER_MINUTE',
    'WIDGET_LIMIT_PER_WIDGET_PER_MINUTE',
    'WIDGET_LIMIT_PER_VISITOR_PER_MINUTE',
  ]) {
    vi.stubEnv(name, '')
  }
  h.streamCalls = 0
  h.dayResult = { ok: true, count: 1 }
  h.hourResult = { ok: true, count: 1 }
  h.rateLimitShared.mockImplementation(async (key: string) => {
    if (key.startsWith('widget-org-day:')) return h.dayResult
    if (key.startsWith('widget-org-hour:')) return h.hourResult
    return { ok: true, count: 1 }
  })
  h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(null))
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 7 })
  h.chatModel.mockResolvedValue({ id: 'fake-model' })
  h.sendWidgetDailyLimitEmail.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('widget chat: which daily limit applies', () => {
  it('uses the instance ceiling when the owner set no limit', async () => {
    const res = await ask()
    expect(res.status).toBe(200)
    await drain(res)
    expect(dailyMax()).toBe(3_000)
  })

  it("uses the owner's own limit as the daily maximum", async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(250))
    await drain(await ask())
    expect(dailyMax()).toBe(250)
    expect(h.rateLimitShared).toHaveBeenCalledWith('widget-org-day:42', 250, 24 * 60 * 60_000)
  })

  it("never goes above the instance ceiling, even when the owner's stored limit is higher", async () => {
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '1000')
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(2_000))
    await drain(await ask())
    expect(dailyMax()).toBe(1_000)
  })

  it('uses the configured hourly limit', async () => {
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_HOUR', '75')
    await drain(await ask())
    expect(h.rateLimitShared).toHaveBeenCalledWith('widget-org-hour:42', 75, 60 * 60_000)
  })
})

describe('widget chat: owner emails as the day fills up', () => {
  it('emails a warning on the answer that reaches 80% of the limit', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(100))
    h.dayResult = { ok: true, count: 80 }
    const res = await ask()
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.sendWidgetDailyLimitEmail).toHaveBeenCalledOnce()
    expect(h.sendWidgetDailyLimitEmail).toHaveBeenCalledWith({ orgId: 42, orgName: 'Acme', kind: 'warning', limit: 100 })
  })

  it('emails that the limit was reached on the answer that reaches it, and still answers it', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(100))
    h.dayResult = { ok: true, count: 100 }
    const res = await ask()
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.sendWidgetDailyLimitEmail).toHaveBeenCalledOnce()
    expect(h.sendWidgetDailyLimitEmail).toHaveBeenCalledWith({ orgId: 42, orgName: 'Acme', kind: 'reached', limit: 100 })
    expect(h.streamCalls).toBe(1)
  })

  it('uses the instance ceiling for the alert points when the owner set no limit', async () => {
    h.dayResult = { ok: true, count: 2_400 }
    await drain(await ask())
    expect(h.sendWidgetDailyLimitEmail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning', limit: 3_000 }))
  })

  it.each([1, 79, 81, 99])('sends nothing at a count of %i', async (count) => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(100))
    h.dayResult = { ok: true, count }
    await drain(await ask())
    expect(h.sendWidgetDailyLimitEmail).not.toHaveBeenCalled()
  })

  it('sends nothing past the limit, so a busy day does not repeat the email', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(100))
    h.dayResult = { ok: false, count: 101 }
    expect((await ask()).status).toBe(429)
    expect(h.sendWidgetDailyLimitEmail).not.toHaveBeenCalled()
  })
})

describe('widget chat: over the daily limit', () => {
  it('returns 429 without reserving quota or reaching the model', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(100))
    h.dayResult = { ok: false, count: 150 }
    const res = await ask()
    expect(res.status).toBe(429)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
    expect(h.streamCalls).toBe(0)
  })

  it('returns 429 when the hourly limit is spent, even if the day has room', async () => {
    h.hourResult = { ok: false, count: 501 }
    expect((await ask()).status).toBe(429)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
  })
})

describe('widget chat: the email never holds up the answer', () => {
  it('answers while the email is still being sent', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWithLimit(100))
    h.dayResult = { ok: true, count: 80 }
    // Never settles: if the route awaited it, this request would hang.
    h.sendWidgetDailyLimitEmail.mockReturnValue(new Promise(() => {}))
    const res = await ask()
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.streamCalls).toBe(1)
    expect(h.commitDeflection).toHaveBeenCalledWith(42, 7)
  })
})
