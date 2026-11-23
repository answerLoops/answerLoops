import { describe, it, expect, vi, beforeEach } from 'vitest'
import { widgetChatRequest, drain, userMsg } from './support/widget-chat-envelope'

/**
 * The widget route with the model's own knowledge-base search wired in. The
 * fake agent below runs the search tool the way a model would mid-turn, then
 * finishes the turn, so each test can check what the route recorded for
 * articles the model found itself.
 */

const VALID_TOKEN = 'f'.repeat(48)

type Article = { summary: string; answer: string; articleId?: number }
type Ctx = { articles: Article[]; matched: boolean }

const h = vi.hoisted(() => ({
  getWidgetKBContext: vi.fn(),
  embedText: vi.fn(),
  setLeadSignal: vi.fn(),
  capture: vi.fn(async () => {}),
  countArticleUsage: vi.fn(async () => {}),
  recordAnswerSources: vi.fn(async () => {}),
  scheduleSourceSupport: vi.fn(),
  agentConfigs: [] as Record<string, any>[],
  streamOptions: [] as Record<string, any>[],
  // Queries the fake model searches with during the turn, in order.
  searches: [] as string[],
  searchResults: [] as string[],
}))

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: vi.fn(async () => ({ granted: true, generationId: 3 })),
  releaseGeneration: vi.fn(async () => {}),
  commitDeflection: vi.fn(async () => {}),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({
  getOrgByWidgetToken: vi.fn(async () => ({
    id: 5,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    widget_lead_capture_mode: 'on-failure',
    widget_answer_scope: 'kb-only',
    widget_guidance: null,
  })),
}))
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
    config: Record<string, any>
    constructor(config: Record<string, any>) {
      this.config = config
      h.agentConfigs.push(config)
    }
    async stream(_q: string, options: Record<string, any>) {
      h.streamOptions.push(options)
      for (const query of h.searches) {
        h.searchResults.push(await this.config.tools.search_knowledge_base.execute({ query }, {}))
      }
      await options?.onFinish?.({ text: 'A reply.' })
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

const pro: Article = { summary: 'Pricing › Pro', answer: '$49 a month.', articleId: 1 }
const team: Article = { summary: 'Pricing › Team', answer: '$149 a month. See https://acme.test/teams', articleId: 2 }

// The pre-fetch searches the visitor's own words; anything else is the model's search.
function kbFor(prefetch: Ctx, bySearch: Record<string, Ctx> = {}) {
  h.getWidgetKBContext.mockImplementation(async (vector: number[]) => {
    const query = String(vector[0])
    return bySearch[query] ?? prefetch
  })
  // The fake embedding carries the text through, so the KB mock can tell searches apart.
  h.embedText.mockImplementation(async (text: string) => [text as unknown as number])
}

async function ask(question: string) {
  const { POST } = await import('@/app/api/widget/chat/route')
  const res = await POST(widgetChatRequest({ widgetToken: VALID_TOKEN, visitorId: 'v1', turnId: 'turn-1', messages: [userMsg(question)] }))
  await drain(res)
  return res
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.agentConfigs.length = 0
  h.streamOptions.length = 0
  h.searches = []
  h.searchResults = []
  const { clearEmbedQueryCache } = await import('@/lib/widget/embed-cache')
  clearEmbedQueryCache()
  kbFor({ articles: [], matched: false })
})

describe('widget route: the model can search the knowledge base itself', () => {
  it('registers search_knowledge_base alongside the display tools', async () => {
    await ask('and for teams?')
    expect(Object.keys(h.agentConfigs[0].tools)).toContain('search_knowledge_base')
    expect(Object.keys(h.agentConfigs[0].tools)).toContain('show_link_card')
  })

  it('tells the model when to search, and not to search for greetings or answered questions', async () => {
    await ask('and for teams?')
    const instructions: string = h.agentConfigs[0].instructions
    expect(instructions).toContain('search_knowledge_base')
    expect(instructions).toMatch(/follow-up/i)
    expect(instructions).toMatch(/greeting/i)
    // Text from every step is joined into one reply, so a "let me look that up"
    // before the search would end up glued to the answer.
    expect(instructions).toMatch(/never tell the visitor you are searching/i)
  })

  it('keeps old search results out of later turns, and only search results', async () => {
    const { ToolCallFilter } = await import('@mastra/core/processors')
    await ask('and for teams?')
    const processors: unknown[] = h.agentConfigs[0].inputProcessors
    expect(processors).toHaveLength(1)
    expect(processors[0]).toBeInstanceOf(ToolCallFilter)
    expect((processors[0] as { exclude?: string[] }).exclude ?? (processors[0] as any).options?.exclude).toEqual(['search_knowledge_base'])
  })

  it('never streams search calls or their article text to the browser', async () => {
    const fs = await import('node:fs')
    const route = fs.readFileSync('app/api/widget/chat/route.ts', 'utf8')
    expect(route).toMatch(/flattenMastraStream\([^)]*onFirstText,\s*\[SEARCH_TOOL_NAME\]\)/)
  })

  it('sets the step limit explicitly', async () => {
    await ask('and for teams?')
    expect(h.streamOptions[0].maxSteps).toBe(6)
  })

  it('records articles a search found like pre-fetched ones, and offers no email card under them', async () => {
    kbFor({ articles: [pro], matched: false }, { 'Team plan price': { articles: [team], matched: false } })
    h.searches = ['Team plan price']
    await ask('and for teams?')
    expect(h.searchResults[0]).toContain('$149 a month.')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'v1', 'turn-1', 'none', expect.any(String))
    expect(h.countArticleUsage).toHaveBeenCalledWith(5, [pro, team])
    expect(h.recordAnswerSources).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'generated', context: [pro, team] }))
    expect(h.scheduleSourceSupport).toHaveBeenCalledWith(expect.objectContaining({ context: [pro, team] }))
  })

  it('lets a link card use a URL from an article the search found', async () => {
    kbFor({ articles: [], matched: false }, { 'Team plan price': { articles: [team], matched: true } })
    h.searches = ['Team plan price']
    await ask('and for teams?')
    const link = await h.agentConfigs[0].tools.show_link_card.execute({ title: 'Teams', url: 'https://acme.test/teams' }, {})
    expect(link.ok).toBe(true)
  })

  it('offers the email card only when neither the pre-fetch nor a search found anything', async () => {
    h.searches = ['Team plan price']
    await ask('and for teams?')
    expect(h.setLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'v1', 'turn-1', 'no-kb-match', expect.any(String))
  })

  it('does not queue the question when a search strongly matches an article the pre-fetch only found as a near miss', async () => {
    kbFor({ articles: [team], matched: false }, { 'Team plan price': { articles: [team], matched: true } })
    h.searches = ['Team plan price']
    await ask('and for teams?')
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.countArticleUsage).toHaveBeenCalledWith(5, [team])
  })

  it('does not queue the question for review when a search found a strong match', async () => {
    kbFor({ articles: [], matched: false }, { 'Team plan price': { articles: [team], matched: true } })
    h.searches = ['Team plan price']
    await ask('and for teams?')
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('queues the standalone question, with the visitor words beside it, when searches found only near misses', async () => {
    kbFor({ articles: [], matched: false }, { 'Team plan price': { articles: [team], matched: false } })
    h.searches = ['Team plan price']
    await ask('and for teams?')
    expect(h.capture).toHaveBeenCalledTimes(1)
    const arg = (h.capture.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg).toMatchObject({ orgId: 5, source: 'widget', question: 'Team plan price', visitorMessage: 'and for teams?', answer: 'A reply.' })
    expect(arg.embedding).toEqual(['Team plan price'])
  })

  it('queues the visitor words alone, exactly as before, when the model never searched', async () => {
    await ask('do you have SSO?')
    const arg = (h.capture.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg.question).toBe('do you have SSO?')
    expect(arg).not.toHaveProperty('visitorMessage')
    expect(arg.embedding).toEqual(['do you have SSO?'])
  })
})
