import { generateText, embed } from 'ai'
import { buildChatProvider, buildEmbeddingModel } from '@/lib/ai/models'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'
import { assertPublicHttpsUrl, UnsafeUrlError } from '@/lib/http/safe-url'

const MOD = 'ai/test-connection'

export interface AIConnectionCheck {
  ok: boolean
  error?: string
  /** Shown in place of "connection OK" when the check was not a live call. */
  note?: string
}

export interface AIConnectionResult {
  chat: AIConnectionCheck
  embedding: AIConnectionCheck
}

interface AIConnectionInput {
  chatProvider: string
  chatModel: string
  chatApiKey: string | null
  chatBaseUrl: string | null
  embeddingProvider: string
  embeddingModel: string
  embeddingApiKey: string | null
  embeddingBaseUrl: string | null
  /** Knowledge-base processing will use included AI usage, so there is no embedding provider to call. */
  skipEmbedding?: boolean
}

export const INCLUDED_EMBEDDINGS_NOTE = 'knowledge-base processing will use included AI usage. Add an OpenAI key under Embeddings to remove the limit.'

const UNSAFE_URL_MESSAGE = 'The base URL must be a public https address (no credentials, no private or local hosts).'

function shortError(err: unknown): string {
  if (err instanceof UnsafeUrlError) return UNSAFE_URL_MESSAGE
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
  // Anything else is provider-specific text; keep it out of the response.
  return 'The provider returned an error. Check the key, model ID and base URL.'
}

/**
 * Run a tiny live call against a chat provider and an embedding provider using
 * the given credentials, so the Settings form can tell the user whether a
 * config works BEFORE they save it. Never persists anything.
 */
export async function testAIProviderConnection(input: AIConnectionInput): Promise<AIConnectionResult> {
  if (MOCK_EXTERNALS) {
    return { chat: { ok: true }, embedding: input.skipEmbedding ? { ok: true, note: INCLUDED_EMBEDDINGS_NOTE } : { ok: true } }
  }

  const chat: AIConnectionCheck = await (async () => {
    try {
      if (input.chatBaseUrl) await assertPublicHttpsUrl(input.chatBaseUrl)
      const provider = buildChatProvider(input.chatProvider, input.chatApiKey, input.chatBaseUrl)
      await generateText({
        model: provider(input.chatModel),
        prompt: 'Reply with the single word: ok',
        // Newer OpenAI models reject anything below 16 (`max_output_tokens`
        // must be >= 16) — this used to be 4, which was enough for older
        // models but now fails the connection test outright before the
        // prompt is even answered.
        maxOutputTokens: 16,
      })
      return { ok: true }
    } catch (err) {
      logger.info('ai test — chat failed', { module: MOD, provider: input.chatProvider, error: err })
      return { ok: false, error: shortError(err) }
    }
  })()

  const embedding: AIConnectionCheck = await (async () => {
    if (input.skipEmbedding) return { ok: true, note: INCLUDED_EMBEDDINGS_NOTE }
    try {
      if (input.embeddingBaseUrl) await assertPublicHttpsUrl(input.embeddingBaseUrl)
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
