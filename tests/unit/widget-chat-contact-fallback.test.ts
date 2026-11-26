import { describe, it, expect, vi, beforeEach } from 'vitest'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'
import { CONTACT_LOOKUP_QUERY } from '@/lib/widget/contact-context'

/**
 * The widget route's fallback for a question the knowledge base doesn't
 * cover, in a workspace that answers only from its knowledge base: the route
 * also looks up how to reach the business, shows that to the model, and lets
 * the contact card use it, without counting it as an article that answered
 * the question. The fake agent records its config and finishes the turn, so
 * each test can call the real card tools and check what the route recorded.
 */

const VALID_TOKEN = 'a'.repeat(48)

type Article = { summary: string; answer: string; articleId?: number }
type Ctx = { articles: Article[]; matched: boolean }

const h = vi.hoisted(() => ({
  org: vi.fn(),
  getWidgetKBContext: vi.fn(),
  embedText: vi.fn(),
  setLeadSignal: vi.fn(),
  capture: vi.fn(async () => {}),
  countArticleUsage: vi.fn(async () => {}),
  recordAnswerSources: vi.fn(async () => {}),
  scheduleSourceSupport: vi.fn(),
  agentConfigs: [] as Record<string, any>[],
}))

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: vi.fn(async () => ({ granted: true, generationId: 3 })),
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.org }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({ id: 'fake-model' })),
  DEFAULT_FAST_MODEL: 'fake-model',
  NoAIProviderConfiguredError: class extends Error {},
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: () => true }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (text: string) => ({ embedding: await h.embedText(text), model: 'test-embed-model' }),
}))
vi.mock('@/lib/ai/embedding-pin', () => ({ getPinnedModel: async () => 'test-embed-model' }))
vi.mock('@/lib/db/queries/kb', () => ({ getWidgetKBContext: h.getWidgetKBContext }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/kb/review-capture', () => ({ captureUnansweredQuestion: h.capture }))
vi.mock('@/lib/kb/usage', () => ({
  newAnswerId: () => 'answer-1',
  countArticleUsage: h.countArticleUsage,
  recordAnswerSources: h.recordAnswerSources,
}))
vi.mock('@/lib/kb/support/runner', () => ({ scheduleSourceSupport: h.scheduleSourceSupport }))
vi.mock('@/lib/widget/lead-signal-stash', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/widget/lead-signal-stash')>()),
  setLeadSignal: h.setLeadSignal,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: Record<string, any>) {
      h.agentConfigs.push(config)
    }
    async stream(_q: string, options: Record<string, any>) {
      await options?.onFinish?.({ text: 'A reply.' })
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

const org = (scope: string) => ({
  id: 5,
  name: 'Acme',
  widget_token: VALID_TOKEN,
  widget_lead_capture_mode: 'on-failure',
  widget_answer_scope: scope,
  widget_guidance: null,
})

const contactUs: Article = {
  summary: 'Contact us',
  answer: 'Email help@acme.test or call +1 555 010 2000. Our support page is https://acme.test/support',
  articleId: 40,
}
const install: Article = { summary: 'Install', answer: 'Run npm i acme.', articleId: 1 }

// The visitor's question and the contact lookup are told apart by the text the
// fake embedding carries through to the knowledge-base mock.
function kbFor(question: Ctx, contact: Ctx = { articles: [contactUs], matched: false }) {
  h.embedText.mockImplementation(async (text: string) => [text as unknown as number])
  h.getWidgetKBContext.mockImplementation(async (vector: number[]) =>
    String(vector[0]) === CONTACT_LOOKUP_QUERY ? contact : question
  )
}

const lookedUpContact = () => h.embedText.mock.calls.some(([text]) => text === CONTACT_LOOKUP_QUERY)
const instructions = () => h.agentConfigs[0].instructions as string
const contactCard = (value: string, kind = 'email') =>
  h.agentConfigs[0].tools.show_contact_options.execute({ message: 'Reach the team:', options: [{ kind, label: 'Support', value }] }, {})

async function ask(question: string) {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId: 'v1', turnId: 'turn-1', messages: [userMsg(question)] }))
  await drain(res)
  return res
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.agentConfigs.length = 0
  const { clearEmbedQueryCache } = await import('@/lib/widget/embed-cache')
  clearEmbedQueryCache()
  h.org.mockResolvedValue(org('knowledge-base-only'))
  kbFor({ articles: [], matched: false })
})

describe('knowledge-base-only widget, question its articles do not cover', () => {
  it('shows the model how to reach the business, apart from the question context', async () => {
    await ask('Do you ship to Canada?')
    expect(lookedUpContact()).toBe(true)
    expect(instructions()).toContain('How to reach Acme')
    expect(instructions()).toContain('help@acme.test')
    // Not presented as an answer to the question.
    expect(instructions()).not.toContain('Knowledge base context — use this to answer')
  })

  it('lets the contact card show the email, phone and page from the contact article', async () => {
    await ask('Do you ship to Canada?')
    expect((await contactCard('help@acme.test')).ok).toBe(true)
    expect((await contactCard('+1 555 010 2000', 'phone')).ok).toBe(true)
    expect((await contactCard('https://acme.test/support', 'url')).ok).toBe(true)
  })

  it('still refuses contact details that no article states', async () => {
    await ask('Do you ship to Canada?')
    expect((await contactCard('sales@acme.test')).ok).toBe(false)
  })

  it('does not count the contact article as covering the question or as a source of the answer', async () => {
    await ask('Do you ship to Canada?')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'v1', 'turn-1', 'no-kb-match', expect.any(String))
    expect(h.countArticleUsage).toHaveBeenCalledWith(5, [])
    expect(h.recordAnswerSources).toHaveBeenCalledWith(expect.objectContaining({ context: [] }))
    expect(h.capture).toHaveBeenCalledWith(expect.objectContaining({ question: 'Do you ship to Canada?' }))
  })

  it('also shows contact details beside near misses, which may not cover the question either', async () => {
    kbFor({ articles: [install], matched: false })
    await ask('Do you ship to Canada?')
    expect(instructions()).toContain('Run npm i acme.')
    expect(instructions()).toContain('help@acme.test')
  })

  it('leaves out a contact-lookup result that states no way to reach anyone', async () => {
    kbFor({ articles: [], matched: false }, { articles: [{ summary: 'About us', answer: 'We started in 2019.', articleId: 41 }], matched: false })
    await ask('Do you ship to Canada?')
    expect(instructions()).not.toContain('How to reach Acme')
    expect(instructions()).not.toContain('We started in 2019.')
    // The model is still told what to say when there is nothing to show.
    expect(instructions()).toContain('suggest the visitor contact Acme directly')
  })

  it('still answers when the contact lookup fails', async () => {
    h.embedText.mockImplementation(async (text: string) => {
      if (text === CONTACT_LOOKUP_QUERY) throw new Error('embedding provider down')
      return [text as unknown as number]
    })
    const res = await ask('Do you ship to Canada?')
    expect(res.status).toBe(200)
    expect(h.agentConfigs).toHaveLength(1)
    expect(instructions()).not.toContain('How to reach Acme')
  })
})

describe('knowledge-base-only widget, other turns', () => {
  it('adds no contact details when the question is covered', async () => {
    kbFor({ articles: [install], matched: true })
    await ask('How do I install it?')
    expect(instructions()).not.toContain('How to reach Acme')
    expect((await contactCard('help@acme.test')).ok).toBe(false)
  })

  it('does not look up contact details for a greeting or thanks', async () => {
    for (const greeting of ['hi', 'thanks!']) {
      vi.clearAllMocks()
      h.agentConfigs.length = 0
      h.org.mockResolvedValue(org('knowledge-base-only'))
      kbFor({ articles: [], matched: false })
      await ask(greeting)
      expect(lookedUpContact(), greeting).toBe(false)
      expect(instructions(), greeting).not.toContain('How to reach Acme')
    }
  })

  it('does not repeat a contact article the question already found', async () => {
    kbFor({ articles: [contactUs], matched: false })
    await ask('Can I talk to someone?')
    expect(instructions()).not.toContain('How to reach Acme')
    expect(instructions().split('help@acme.test').length - 1).toBe(1)
  })
})

describe('general widget', () => {
  it('never looks up contact details and keeps its instructions unchanged', async () => {
    h.org.mockResolvedValue(org('general'))
    await ask('Do you ship to Canada?')
    expect(lookedUpContact()).toBe(false)
    expect(instructions()).not.toContain('How to reach Acme')
    expect(instructions()).toContain("answer from general knowledge and don't mention that either")
  })
})

describe('contact lookup timing', () => {
  it("starts the contact lookup while the question's own lookup is still in flight", async () => {
    // The question's knowledge-base read is held open until the contact
    // lookup reaches the knowledge base. If the route only started the contact
    // lookup after the question's results came back, it would never arrive and
    // the fallback timer below would release the question instead.
    let contactStartedFirst = false
    let questionReleased = false
    let releaseQuestion!: () => void
    const questionHeld = new Promise<void>((resolve) => {
      releaseQuestion = () => {
        questionReleased = true
        resolve()
      }
    })
    const fallback = setTimeout(() => releaseQuestion(), 1_000)
    h.embedText.mockImplementation(async (text: string) => [text as unknown as number])
    h.getWidgetKBContext.mockImplementation(async (vector: number[]) => {
      if (String(vector[0]) === CONTACT_LOOKUP_QUERY) {
        contactStartedFirst = !questionReleased
        releaseQuestion()
        return { articles: [contactUs], matched: false }
      }
      await questionHeld
      return { articles: [], matched: false }
    })
    try {
      await ask('Do you ship to Canada?')
    } finally {
      clearTimeout(fallback)
    }
    expect(contactStartedFirst).toBe(true)
    expect(instructions()).toContain('help@acme.test')
  })
})

describe('unrecognised answer scope', () => {
  it('looks up contact details exactly when the instructions say knowledge base only', async () => {
    // A scope value that is neither setting must land on the same side in the
    // lookup and in the instructions, never one narrow and the other general.
    for (const scope of [undefined, null, 'kb-only']) {
      vi.clearAllMocks()
      h.agentConfigs.length = 0
      // The contact query's embedding is cached across turns; clear it so each
      // pass shows whether this turn ran the lookup.
      const { clearEmbedQueryCache } = await import('@/lib/widget/embed-cache')
      clearEmbedQueryCache()
      h.org.mockResolvedValue({ ...org('knowledge-base-only'), widget_answer_scope: scope })
      kbFor({ articles: [], matched: false })
      await ask('Do you ship to Canada?')
      expect(lookedUpContact(), String(scope)).toBe(true)
      expect(instructions(), String(scope)).toContain('How to reach Acme')
      expect(instructions(), String(scope)).not.toContain("answer from general knowledge and don't mention that either")
    }
  })
})
