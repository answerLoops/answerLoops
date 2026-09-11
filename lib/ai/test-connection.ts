import { generateText, embed } from 'ai'
import { buildChatProvider, buildEmbeddingModel } from '@/lib/ai/models'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'

const MOD = 'ai/test-connection'

export interface AIConnectionCheck {
  ok: boolean
  error?: string
}

export interface AIConnectionResult {
  chat: AIConnectionCheck
  embedding: AIConnectionCheck
}

export interface AIConnectionInput {
  chatProvider: string
  chatModel: string
  chatApiKey: string | null
  chatBaseUrl: string | null
  embeddingProvider: string
  embeddingModel: string
  embeddingApiKey: string | null
  embeddingBaseUrl: string | null
}

function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Provider SDKs prepend a lot of noise; keep it to something a user can act on.
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (/401|unauthor|invalid.*api.?key|incorrect api key/i.test(cleaned)) {
    return 'The API key was rejected (401). Check the key and that it belongs to this provider.'
  }
  if (/403|forbidden|permission/i.test(cleaned)) return 'The key is valid but not permitted to use this model (403).'
  if (/404|not found|model.*does not exist|unknown model/i.test(cleaned)) {
    return 'The model ID was not found for this provider (404). Check the exact model name.'
  }
  if (/429|rate.?limit|quota/i.test(cleaned)) return 'Rate limited or out of quota (429) — the credentials work.'
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(cleaned)) {
    return 'Could not reach the endpoint — check the base URL and that it is reachable from the server.'
  }
  return cleaned.slice(0, 200)
}

/**
 * Run a tiny live call against a chat provider and an embedding provider using
 * the given credentials, so the Settings form can tell the user whether a
 * config works BEFORE they save it. Never persists anything.
 */
export async function testAIProviderConnection(input: AIConnectionInput): Promise<AIConnectionResult> {
  if (MOCK_EXTERNALS) {
    return { chat: { ok: true }, embedding: { ok: true } }
  }

  const chat: AIConnectionCheck = await (async () => {
    try {
      const provider = buildChatProvider(input.chatProvider, input.chatApiKey, input.chatBaseUrl)
      await generateText({
        model: provider(input.chatModel),
        prompt: 'Reply with the single word: ok',
        maxOutputTokens: 4,
      })
      return { ok: true }
    } catch (err) {
      logger.info('ai test — chat failed', { module: MOD, provider: input.chatProvider, error: err })
      return { ok: false, error: shortError(err) }
    }
  })()

  const embedding: AIConnectionCheck = await (async () => {
    try {
      const model = buildEmbeddingModel(input.embeddingModel, input.embeddingApiKey, input.embeddingBaseUrl)
      await embed({ model, value: 'ok' })
      return { ok: true }
    } catch (err) {
      logger.info('ai test — embedding failed', { module: MOD, provider: input.embeddingProvider, error: err })
      return { ok: false, error: shortError(err) }
    }
  })()

  return { chat, embedding }
}
