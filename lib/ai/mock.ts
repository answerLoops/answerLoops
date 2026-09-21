import { MockLanguageModelV3, MockEmbeddingModelV3 } from 'ai/test'
import type { LanguageModel, EmbeddingModel } from 'ai'

/**
 * AIMock — deterministic stand-ins for the OpenAI models, used by the e2e suite.
 *
 * The mocks are pure functions of their input, so they behave identically in
 * the test runner and in a separately-spawned `next start` process (which is
 * how Playwright drives the app). Each language-model call is routed by a
 * fingerprint of its prompt; embeddings are a hashed bag-of-words so that
 * similar text yields similar vectors and dedup/related logic stays testable.
 *
 * Content markers a test can embed in a Discord message to steer the pipeline:
 *   [[needhuman]]  -> agent returns an unsure answer  -> low confidence -> human review
 *   [[urgent]]     -> triage bumps severity to critical
 */

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

/** Flatten a LanguageModelV3 prompt to a single lowercased text blob. */
function promptToText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return String(prompt ?? '')
  const parts: string[] = []
  for (const msg of prompt as Array<{ role: string; content: unknown }>) {
    if (typeof msg.content === 'string') {
      parts.push(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const p of msg.content as Array<{ type: string; text?: string }>) {
        if (p.type === 'text' && p.text) parts.push(p.text)
      }
    }
  }
  return parts.join('\n')
}

// --- Deterministic generators -------------------------------------------------

// `msg` is the isolated user message (not the surrounding prompt template), so
// keyword matching reflects the question rather than the instructions.
function mockTriage(msg: string): string {
  const t = msg.toLowerCase()
  let category = 'general_question'
  if (/\b(how do i|how to|how can i|where do i)\b/.test(t)) category = 'how_to'
  else if (/\b(error|crash|broken|bug|exception|fails?|stack trace)\b/.test(t)) category = 'bug'
  else if (/\b(feature|add support|would be nice|enhancement|please add)\b/.test(t)) category = 'feature_request'
  else if (/\b(docs|documentation|readme|unclear|outdated)\b/.test(t)) category = 'documentation'

  let severity = 0.4
  if (/\[\[urgent\]\]|\b(production|data loss|security|outage)\b/.test(t)) severity = 0.95
  else if (category === 'bug') severity = 0.6

  const priority = severity >= 0.9 ? 'critical' : severity >= 0.6 ? 'high' : severity >= 0.3 ? 'medium' : 'low'

  const summary = msg.trim().replace(/\s+/g, ' ').slice(0, 120) || 'community question'

  return JSON.stringify({
    category,
    severity_score: severity,
    summary,
    suggested_priority: priority,
    reasoning: `Mock triage: matched category "${category}".`,
  })
}

// `answer` is the isolated proposed-answer section, not the grading rubric.
function mockAssess(answer: string): string {
  const unsure = /couldn'?t find|not sure|\[\[needhuman\]\]|no relevant code|unable to/i.test(answer)
  return JSON.stringify(
    unsure
      ? { confidence: 0.3, answered_fully: false, reasoning: 'Mock assess: answer is vague/unsure.' }
      : { confidence: 0.9, answered_fully: true, reasoning: 'Mock assess: concrete, grounded answer.' }
  )
}

function mockAgentAnswer(text: string): string {
  if (/\[\[needhuman\]\]/i.test(text)) {
    return "I couldn't find relevant code to answer this confidently. A maintainer should take a look."
  }
  return 'Based on the source, call `configure()` in `src/index.ts` before use. See the README for a full example.'
}

function mockFaq(text: string): string {
  const hasContent = /##/.test(text)
  return hasContent
    ? '# FAQ\n\n## How To\n\n**Q: How do I get started?**\n\nCall `configure()` first. See the docs.'
    : '# FAQ\n\nNo resolved tickets this week.'
}

/** Route a language-model call to the right deterministic generator. */
function generateMockText(prompt: unknown): string {
  const text = promptToText(prompt)
  if (/support triage assistant/i.test(text)) {
    return mockTriage(text.split(/Message:\s*/i).pop() ?? '')
  }
  if (/strict reviewer grading/i.test(text)) {
    const answer = (text.split(/Proposed answer:\s*/i)[1] ?? '').split(/Grade the answer:/i)[0]
    return mockAssess(answer)
  }
  if (/technical writer creating a community faq/i.test(text)) return mockFaq(text)
  if (/technical support agent/i.test(text)) return mockAgentAnswer(text)
  // Agent.generate for the answer agent passes the bare question as the prompt; treat
  // anything else as an agent answer.
  return mockAgentAnswer(text)
}

type DoGenerate = InstanceType<typeof MockLanguageModelV3>['doGenerate']
type LMResult = Awaited<ReturnType<DoGenerate>>
type DoStream = InstanceType<typeof MockLanguageModelV3>['doStream']
type LMStreamResult = Awaited<ReturnType<DoStream>>

export function mockLanguageModel(modelId: string): LanguageModel {
  const doGenerate: DoGenerate = async ({ prompt }) =>
    ({
      content: [{ type: 'text', text: generateMockText(prompt) }],
      finishReason: 'stop',
      usage: ZERO_USAGE,
      warnings: [],
    }) as unknown as LMResult

  // Widget chat (and anything else calling stream() rather than generate())
  // needs a real doStream — MockLanguageModelV3 throws "Not implemented" if
  // it's omitted. One text-delta chunk is enough for deterministic tests;
  // real token-by-token chunking isn't something a test asserts on.
  const doStream: DoStream = async ({ prompt }) => {
    const text = generateMockText(prompt)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        controller.enqueue({ type: 'text-start', id: '0' })
        controller.enqueue({ type: 'text-delta', id: '0', delta: text })
        controller.enqueue({ type: 'text-end', id: '0' })
        controller.enqueue({ type: 'finish', finishReason: 'stop', usage: ZERO_USAGE })
        controller.close()
      },
    })
    return { stream } as unknown as LMStreamResult
  }

  return new MockLanguageModelV3({ modelId, doGenerate, doStream }) as unknown as LanguageModel
}

// --- Embeddings ---------------------------------------------------------------

// Must equal KB_EMBEDDING_DIMENSIONS (lib/ai/embed.ts): kb_articles.embedding_vec
// is a fixed-width pgvector column, and Postgres rejects an insert of any other
// length. Not imported from embed.ts to keep this file free of app imports; a
// unit test (tests/unit/mock-embedding-dimensions.test.ts) keeps the two in sync.
const EMBED_DIM = 1536

/** Hashed bag-of-words unit vector — similar text → similar vector. */
function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0)
  for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0
    v[h % EMBED_DIM] += 1
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

type DoEmbed = InstanceType<typeof MockEmbeddingModelV3>['doEmbed']
type EmbResult = Awaited<ReturnType<DoEmbed>>

export const MOCK_EMBEDDING_DIMENSIONS = EMBED_DIM

export function mockEmbeddingModel(modelId: string): EmbeddingModel {
  const doEmbed: DoEmbed = async ({ values }) =>
    ({
      embeddings: (values as string[]).map(hashEmbed),
      usage: { tokens: 0 },
      warnings: [],
    }) as unknown as EmbResult
  return new MockEmbeddingModelV3({ modelId, doEmbed }) as unknown as EmbeddingModel
}
