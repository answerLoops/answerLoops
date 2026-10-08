import { describe, it, expect, vi, beforeEach } from 'vitest'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * Behavioural coverage for the reworked widget chat route: retrieval started
 * after the quota grant and overlapped with model resolution, the paired
 * per-token rate-limit counters, the display-only genui tools grounded in the
 * same context block as the instructions, and the single timing log line.
 * Complements widget-chat-quota-and-validation.test.ts (validation / quota /
 * release basics), which this file deliberately does not repeat.
 */

const VALID_TOKEN = 'b'.repeat(48)

const h = vi.hoisted(() => ({
  reserveGeneration: vi.fn(),
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
  rateLimitShared: vi.fn(),
  getOrgByWidgetToken: vi.fn(),
  chatModel: vi.fn(),
  embedText: vi.fn(),
  getKBContext: vi.fn(),
  loggerInfo: vi.fn(),
  agentConfigs: [] as Record<string, any>[],
  streamCalls: [] as { query: string }[],
  streamChunks: [] as unknown[],
}))

class FakeNoProviderError extends Error {}

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  releaseGeneration: h.releaseGeneration,
  commitDeflection: h.commitDeflection,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: h.chatModel,
  DEFAULT_FAST_MODEL: 'fake-model',
  NoAIProviderConfiguredError: FakeNoProviderError,
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: () => true }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ai/embed', () => ({ embedText: h.embedText }))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: h.getKBContext }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/logger', () => ({
  logger: { info: h.loggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: Record<string, any>) {
      h.agentConfigs.push(config)
    }
    async stream(query: string, options?: { onFinish?: () => void | Promise<void> }) {
      h.streamCalls.push({ query })
      await options?.onFinish?.()
      const chunks = h.streamChunks
      return {
        fullStream: new ReadableStream({
          start(c) {
            for (const ch of chunks) c.enqueue(ch)
            c.close()
          },
        }),
      }
    }
  },
}))

async function callRoute(query = 'how do I reset my password?') {
  const { POST } = await import('@/app/api/widget/chat/route')
  return POST(widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId: 'v1', messages: [userMsg(query)] }))
}

const textDelta = (text: string) => ({ type: 'text-delta', payload: { id: 't1', text }, runId: 'r', from: 'AGENT' })

beforeEach(async () => {
  vi.clearAllMocks()
  h.agentConfigs.length = 0
  h.streamCalls.length = 0
  h.streamChunks = []
  const { clearEmbedQueryCache } = await import('@/lib/widget/embed-cache')
  clearEmbedQueryCache()
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.getOrgByWidgetToken.mockResolvedValue({ id: 77, name: 'Acme', widget_token: VALID_TOKEN })
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 9 })
  h.chatModel.mockResolvedValue({ id: 'fake-model' })
  h.embedText.mockResolvedValue([0.1, 0.2])
  h.getKBContext.mockResolvedValue([])
})

describe('widget chat route: retrieval only starts after the quota grant', () => {
  it('a 402 refusal never embeds, searches the KB, or resolves a model', async () => {
    h.reserveGeneration.mockResolvedValueOnce({ granted: false, reason: 'deflection-limit', used: 5, limit: 5 })
    const res = await callRoute('refused question')
    expect(res.status).toBe(402)
    expect(h.embedText).not.toHaveBeenCalled()
    expect(h.getKBContext).not.toHaveBeenCalled()
    expect(h.chatModel).not.toHaveBeenCalled()
    expect(h.agentConfigs).toHaveLength(0)
  })

  it('a granted request embeds with the org id and searches that org KB', async () => {
    const res = await callRoute('granted question')
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.embedText).toHaveBeenCalledWith('granted question', 77)
    expect(h.getKBContext).toHaveBeenCalledWith([0.1, 0.2], 5, 77)
  })
})

describe('widget chat route: a missing AI provider releases the slot and builds no agent', () => {
  it('returns 503, releases the generation id, and never constructs the Agent', async () => {
    h.chatModel.mockRejectedValueOnce(new FakeNoProviderError('none'))
    const res = await callRoute('no provider question')
    expect(res.status).toBe(503)
    expect(h.releaseGeneration).toHaveBeenCalledTimes(1)
    expect(h.releaseGeneration).toHaveBeenCalledWith(9)
    expect(h.agentConfigs).toHaveLength(0)
    expect(h.streamCalls).toHaveLength(0)
    expect(h.commitDeflection).not.toHaveBeenCalled()
  })
})

describe('widget chat route: retrieval failure is non-fatal', () => {
  it('still streams an answer without KB context when the embedding step throws', async () => {
    h.embedText.mockRejectedValueOnce(new Error('embedding provider down'))
    const res = await callRoute('embedding failure question')
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.streamCalls).toHaveLength(1)
    expect(h.agentConfigs[0].instructions).not.toContain('Knowledge base context')
    expect(h.getKBContext).not.toHaveBeenCalled()
    expect(h.releaseGeneration).not.toHaveBeenCalled()
    expect(h.commitDeflection).toHaveBeenCalledWith(77, 9)
  })

  it('still streams when the KB search throws', async () => {
    h.getKBContext.mockRejectedValueOnce(new Error('db down'))
    const res = await callRoute('kb failure question')
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.streamCalls).toHaveLength(1)
    expect(h.agentConfigs[0].instructions).not.toContain('Knowledge base context')
  })
})

describe('widget chat route: genui tools are grounded in the same context block as the instructions', () => {
  const KB = [
    {
      summary: 'Billing help',
      answer: 'See https://docs.acme.test/billing for details or email help@acme.test or call +1 (555) 010-2030.',
    },
  ]

  it('registers exactly the five display-only tools', async () => {
    const res = await callRoute('tools question')
    await drain(res)
    expect(Object.keys(h.agentConfigs[0].tools).sort()).toEqual(
      ['show_callout', 'show_choices', 'show_contact_options', 'show_link_card', 'show_steps'].sort()
    )
  })

  it('allows a URL from the KB context through show_link_card and refuses one that is not', async () => {
    h.getKBContext.mockResolvedValueOnce(KB)
    const res = await callRoute('billing link question')
    await drain(res)
    const config = h.agentConfigs[0]
    // The context placed in the instructions is the same text the tools check.
    expect(config.instructions).toContain('https://docs.acme.test/billing')

    const allowed = await config.tools.show_link_card.execute(
      { title: 'Billing', url: 'https://docs.acme.test/billing' },
      {}
    )
    expect(allowed).toMatchObject({ ok: true, data: { url: 'https://docs.acme.test/billing' } })

    const invented = await config.tools.show_link_card.execute(
      { title: 'Other', url: 'https://elsewhere.example/login' },
      {}
    )
    expect(invented).toEqual({ ok: false })
  })

  it('keeps only contact values present in the KB context', async () => {
    h.getKBContext.mockResolvedValueOnce(KB)
    const res = await callRoute('contact question')
    await drain(res)
    const result = await h.agentConfigs[0].tools.show_contact_options.execute(
      {
        message: 'Reach us',
        options: [
          { kind: 'email', label: 'Email', value: 'help@acme.test' },
          { kind: 'email', label: 'Other', value: 'other@elsewhere.example' },
        ],
      },
      {}
    )
    expect(result.ok).toBe(true)
    expect(result.data.options).toEqual([expect.objectContaining({ value: 'help@acme.test' })])
  })

  it('refuses every link when no context was retrieved', async () => {
    const res = await callRoute('no context question')
    await drain(res)
    const result = await h.agentConfigs[0].tools.show_link_card.execute(
      { title: 'Billing', url: 'https://docs.acme.test/billing' },
      {}
    )
    expect(result).toEqual({ ok: false })
  })
})

describe('widget chat route: both per-token rate-limit counters are always charged', () => {
  const tokenKey = `widget-token:${VALID_TOKEN}`
  const ipKey = `widget-ip:${VALID_TOKEN}:203.0.113.9`
  const calledKeys = () => h.rateLimitShared.mock.calls.map((c) => c[0] as string)

  it('charges the ip counter and returns 429 even when the token counter is not ok', async () => {
    h.rateLimitShared.mockImplementation(async (key: string) => ({ ok: key !== tokenKey }))
    const res = await callRoute('rl token')
    expect(res.status).toBe(429)
    expect(calledKeys()).toContain(tokenKey)
    expect(calledKeys()).toContain(ipKey)
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
    expect(h.reserveGeneration).not.toHaveBeenCalled()
  })

  it('charges the token counter and returns 429 when only the ip counter is not ok', async () => {
    h.rateLimitShared.mockImplementation(async (key: string) => ({ ok: key !== ipKey }))
    const res = await callRoute('rl ip')
    expect(res.status).toBe(429)
    expect(calledKeys()).toContain(tokenKey)
    expect(calledKeys()).toContain(ipKey)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
  })
})

describe('widget chat route: timing log', () => {
  const timingCalls = () => h.loggerInfo.mock.calls.filter((c) => c[0] === 'widget chat timing')

  it('emits exactly one timing line with numeric prepMs and ttftMs for a streamed answer', async () => {
    h.streamChunks = [textDelta('Hel'), textDelta('lo'), textDelta('!')]
    const res = await callRoute('timing question')
    await drain(res)
    const calls = timingCalls()
    expect(calls).toHaveLength(1)
    const fields = calls[0][1]
    expect(fields.orgId).toBe(77)
    expect(typeof fields.prepMs).toBe('number')
    expect(typeof fields.ttftMs).toBe('number')
    expect(Number.isFinite(fields.prepMs)).toBe(true)
    expect(fields.prepMs).toBeGreaterThanOrEqual(0)
    expect(fields.ttftMs).toBeGreaterThanOrEqual(fields.prepMs)
  })

  it('emits no timing line when the stream carries no text', async () => {
    h.streamChunks = [{ type: 'finish', payload: { stepResult: {} }, runId: 'r', from: 'AGENT' }]
    const res = await callRoute('silent question')
    await drain(res)
    expect(timingCalls()).toHaveLength(0)
  })
})
