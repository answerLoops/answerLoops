import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * What the widget is allowed to put in front of an anonymous visitor.
 *
 * Published knowledge-base articles: yes. Ticket-derived text: no. Resolved
 * tickets' resolution notes and AI drafts are written for the one person who
 * raised the ticket and routinely carry specifics — names, account and order
 * details, internal reasoning — and the model has no way to tell which parts
 * were meant to stay internal.
 *
 * The product's own answer to "make this answer publicly reusable" is promoting
 * it into the knowledge base, which is the human review step that generalises
 * it. Ticket text only becomes publicly answerable once promoted.
 *
 * Ticket-derived context is still correct for the internal draft pipeline,
 * which is staff-facing — so this is a boundary about audience, not a claim
 * that the data is low quality, and the tests below assert the boundary rather
 * than removal everywhere.
 */

const h = vi.hoisted(() => ({
  getKBContext: vi.fn(),
  getPriorAnswers: vi.fn(),
  getCandidateVectors: vi.fn(),
  reserveGeneration: vi.fn(),
  getOrgByWidgetToken: vi.fn(),
  streamCalls: [] as { instructions: string }[],
}))

vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: h.getKBContext }))
// Mocked so that a reintroduced import would be observable rather than silently
// hitting a real query.
vi.mock('@/lib/db/queries/embeddings', () => ({
  getPriorAnswers: h.getPriorAnswers,
  getCandidateVectors: h.getCandidateVectors,
}))
vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  commitDeflection: vi.fn(),
  releaseGeneration: vi.fn(),
}))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn(async () => [0.1]) }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({ id: 'fake' })),
  DEFAULT_FAST_MODEL: 'fake',
  NoAIProviderConfiguredError: class extends Error {},
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    instructions: string
    constructor(cfg: { instructions: string }) {
      this.instructions = cfg.instructions
    }
    async stream() {
      h.streamCalls.push({ instructions: this.instructions })
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

const VALID_TOKEN = 'b'.repeat(48)

async function ask(question = 'how do I install this?') {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(
    widgetChatRequest({
      widgetToken: VALID_TOKEN,
      visitorId: 'v1',
      messages: [userMsg(question)],
    })
  )
  await drain(res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.streamCalls.length = 0
  h.getOrgByWidgetToken.mockResolvedValue({
    id: 7,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    plan_id: 'starter',
    widget_allowed_origins: null,
  })
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 1 })
  h.getKBContext.mockResolvedValue([])
})

describe('the widget grounds answers in published KB articles only', () => {
  it('never consults ticket-derived context', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])

    await ask()

    expect(h.getKBContext).toHaveBeenCalledOnce()
    // These return resolution notes and AI drafts from real tickets.
    expect(h.getPriorAnswers, 'ticket-derived context reached the widget').not.toHaveBeenCalled()
    expect(h.getCandidateVectors).not.toHaveBeenCalled()
  })

  it('puts the KB article into the prompt it sends', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])

    await ask()

    expect(h.streamCalls).toHaveLength(1)
    expect(h.streamCalls[0].instructions).toContain('Install')
    expect(h.streamCalls[0].instructions).toContain('Run npm i')
  })

  it('gives the KB the whole context budget rather than reserving a slot', async () => {
    // Previously the KB was capped at 4 of 5 slots with the tail left for a
    // prior answer. With that source gone the budget should not stay shrunk.
    await ask()
    const [, k] = h.getKBContext.mock.calls[0]
    expect(k).toBe(5)
  })

  it('still answers when the org has no KB at all, without falling back to tickets', async () => {
    // The honest consequence of this boundary: a brand-new org with an empty
    // knowledge base gets an ungrounded answer rather than one grounded in
    // other people's ticket history. That is the intended trade, and it must
    // not regress into quietly reading tickets again.
    h.getKBContext.mockResolvedValue([])

    const res = await ask()

    expect(res.status).toBe(200)
    expect(h.getPriorAnswers).not.toHaveBeenCalled()
    expect(h.streamCalls).toHaveLength(1)
    // No context block at all, rather than an empty-but-present one.
    expect(h.streamCalls[0].instructions).not.toContain('Knowledge base context')
  })

  it('does not break when KB retrieval throws', async () => {
    h.getKBContext.mockRejectedValue(new Error('embedding down'))
    const res = await ask()
    expect(res.status).toBe(200)
  })
})

describe('the boundary is about audience, not data quality', () => {
  it('leaves ticket-derived context in place for the internal draft pipeline', () => {
    // lib/ingest/pipeline.ts is staff-facing: a human reviews the draft before
    // anything is sent. Removing it there would be a different, unwanted change.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/ingest/pipeline.ts'), 'utf-8')
    expect(src).toContain('getPriorAnswers')
  })

  it('the widget route no longer imports the ticket-derived helpers', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/widget/chat/route.ts'),
      'utf-8'
    )
    const code = src.replace(/\/\/.*$/gm, '') // the comment explains why they are gone
    expect(code).not.toContain('getPriorAnswers')
    expect(code).not.toContain('getCandidateVectors')
  })
})
