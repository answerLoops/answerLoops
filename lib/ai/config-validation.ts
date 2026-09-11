import type { OrgAIConfig } from '@/lib/db/queries/ai-config'

export const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  'openai-compatible': 'a custom OpenAI-compatible endpoint',
}

export interface AIConfigInput {
  chat_provider: string
  chat_model: string
  chat_api_key?: string
  chat_base_url?: string
  embedding_provider: string
  embedding_model: string
  embedding_api_key?: string
  embedding_base_url?: string
}

/**
 * Reject configs that parse fine but can't actually run: a named provider with
 * no key, OpenAI embeddings with a non-OpenAI chat provider and no embedding
 * key, a custom endpoint with no base URL, and — the common footgun — changing
 * the provider while leaving the key field blank, which would otherwise reuse
 * the previous provider's key and 401 on every call.
 *
 * Returns an error message, or null when the config is usable.
 */
export function validateAIConfig(d: AIConfigInput, existing: OrgAIConfig | null): string | null {
  const chatKeyPresent = !!d.chat_api_key || !!existing?.chat_api_key
  const embedKeyPresent = !!d.embedding_api_key || !!existing?.embedding_api_key
  const chatLabel = PROVIDER_LABEL[d.chat_provider] ?? d.chat_provider

  // Provider switched, no fresh key entered → the stored key is for the old one.
  if (
    existing &&
    existing.chat_provider !== d.chat_provider &&
    !d.chat_api_key &&
    d.chat_provider !== 'openai-compatible'
  ) {
    return `You changed the chat provider to ${chatLabel}. Enter an API key for it — the saved key was for ${PROVIDER_LABEL[existing.chat_provider] ?? existing.chat_provider}.`
  }
  if (
    existing &&
    existing.embedding_provider !== d.embedding_provider &&
    d.embedding_provider === 'openai' &&
    !d.embedding_api_key &&
    d.chat_provider !== 'openai'
  ) {
    return 'You changed the embedding provider to OpenAI. Enter an OpenAI API key for embeddings.'
  }

  // Named chat provider (not a keyless local endpoint) needs a key.
  if (d.chat_provider !== 'openai-compatible' && !chatKeyPresent) {
    return `Add an API key for ${chatLabel}.`
  }

  // A custom endpoint needs somewhere to send requests.
  if (d.chat_provider === 'openai-compatible' && !d.chat_base_url && !existing?.chat_base_url) {
    return 'A base URL is required for a custom OpenAI-compatible chat endpoint.'
  }
  if (d.embedding_provider === 'openai-compatible' && !d.embedding_base_url && !existing?.embedding_base_url) {
    return 'A base URL is required for a custom OpenAI-compatible embedding endpoint.'
  }

  // OpenAI embeddings only inherit the chat key when the chat provider is also
  // OpenAI. Any other chat provider must supply a dedicated embedding key, or
  // every KB search and ingest hits NoAIProviderConfiguredError after save.
  if (d.embedding_provider === 'openai' && d.chat_provider !== 'openai' && !embedKeyPresent) {
    return "OpenAI embeddings need their own API key when your chat provider isn't OpenAI — add one under Embeddings."
  }

  return null
}
