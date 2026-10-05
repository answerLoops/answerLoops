import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { widgetChatRequest, userMsg } from './support/widget-chat-envelope'

/**
 * End-to-end wiring for Known Issue 114: the chat and lead routes must
 * actually call the real verifyRenderToken (no mock here, unlike the other
 * widget-chat suites), proving a request that never passed the origin
 * allowlist — i.e. has no valid renderToken for its widgetToken — is
 * rejected before any billed work (reserveGeneration, the model call,
 * saveWidgetLead) happens.
 */

const VALID_TOKEN = 'c'.repeat(48)
const OTHER_TOKEN = 'd'.repeat(48)

const h = vi.hoisted(() => ({
  reserveGeneration: vi.fn(async () => ({ granted: true, generationId: 1 })),
  getOrgByWidgetToken: vi.fn(async () => ({ id: 1, name: 'Acme' })),
  saveWidgetLead: vi.fn(async () => {}),
}))

vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/db/queries/widget-leads', () => ({ saveWidgetLead: h.saveWidgetLead }))
vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
}))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({ id: 'fake' })),
  DEFAULT_FAST_MODEL: 'fake',
  NoAIProviderConfiguredError: class extends Error {},
}))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn(async () => [0.1]) }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: vi.fn(async () => []) }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream() {
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 1 })
  h.getOrgByWidgetToken.mockResolvedValue({ id: 1, name: 'Acme' })
  process.env.AUTH_SECRET = 'test-auth-secret-value'
})

afterEach(() => {
  delete process.env.AUTH_SECRET
})

describe('app/api/widget/chat/route.ts — renderToken is actually enforced', () => {
  it('rejects a request with no renderToken before reserving any quota', async () => {
    const { POST } = await import('@/app/api/widget/chat/route')
    const res = await POST(
      widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId: 'v1', messages: [userMsg('hi')] })
    )
    expect(res.status).toBe(403)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
  })

  it('rejects a renderToken minted for a different widgetToken', async () => {
    const { mintRenderToken } = await import('@/lib/widget/render-token')
    const { POST } = await import('@/app/api/widget/chat/route')
    const stolenToken = mintRenderToken(OTHER_TOKEN)
    const res = await POST(
      widgetChatRequest({
        widgetToken: VALID_TOKEN,
        renderToken: stolenToken,
        visitorId: 'v1',
        messages: [userMsg('hi')],
      })
    )
    expect(res.status).toBe(403)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
  })

  it('accepts a renderToken actually minted for this widgetToken', async () => {
    const { mintRenderToken } = await import('@/lib/widget/render-token')
    const { POST } = await import('@/app/api/widget/chat/route')
    const token = mintRenderToken(VALID_TOKEN)
    const res = await POST(
      widgetChatRequest({
        widgetToken: VALID_TOKEN,
        renderToken: token,
        visitorId: 'v1',
        messages: [userMsg('hi')],
      })
    )
    expect(res.status).not.toBe(403)
  })
})

describe('app/api/widget/lead/route.ts — renderToken is actually enforced', () => {
  function leadRequest(body: Record<string, unknown>) {
    return new Request('https://app.test/api/widget/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects a lead post with no renderToken before writing anything', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest({ widgetToken: VALID_TOKEN, email: 'visitor@example.com' }))
    expect(res.status).toBe(403)
    expect(h.saveWidgetLead).not.toHaveBeenCalled()
  })

  it('accepts a lead post carrying a renderToken minted for this widgetToken', async () => {
    const { mintRenderToken } = await import('@/lib/widget/render-token')
    const { POST } = await import('@/app/api/widget/lead/route')
    const token = mintRenderToken(VALID_TOKEN)
    const res = await POST(
      leadRequest({ widgetToken: VALID_TOKEN, renderToken: token, email: 'visitor@example.com' })
    )
    expect(res.status).not.toBe(403)
    expect(h.saveWidgetLead).toHaveBeenCalled()
  })
})
