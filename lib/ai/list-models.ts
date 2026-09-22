/**
 * Live "what models does this provider currently offer" lookups, so
 * Settings → AI Model's dropdown doesn't go stale every time a provider
 * ships a new model — each provider exposes a `/v1/models`-shaped
 * list endpoint; this normalizes each one's response shape into a plain
 * sorted string array of model IDs.
 *
 * Every function here takes the credentials the user just typed (or the
 * org's saved ones) directly — no DB read, mirroring lib/ai/test-connection.ts.
 * Failures throw; callers decide how to degrade (fall back to a static list).
 */

const FETCH_TIMEOUT_MS = 8_000

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Model list request failed (${res.status}): ${await res.text().catch(() => res.statusText)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

interface OpenAICompatibleModelList {
  data?: { id: string }[]
}

// OpenAI's /v1/models lists every model type it hosts — chat, embeddings,
// tts, whisper, moderation, image — with no capability field to filter on.
// This heuristic keeps chat-shaped families and drops everything else,
// matching the prefixes this app's own model IDs use (see
// lib/ai/models.ts's DEFAULT_CHAT_MODEL/DEFAULT_FAST_MODEL).
const NON_CHAT_MODEL_PATTERN = /embedding|whisper|tts|moderation|dall-e|image|davinci|babbage/i
const OPENAI_CHAT_MODEL_PATTERN = /^(gpt-|chatgpt-|o[0-9])/i

export async function listOpenAIModels(apiKey: string, baseUrl?: string | null): Promise<string[]> {
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const json = (await fetchJson(`${base}/models`, {
    Authorization: `Bearer ${apiKey}`,
  })) as OpenAICompatibleModelList
  const ids = (json.data ?? []).map((m) => m.id)
  // The chat-vs-everything-else heuristic only makes sense against the real
  // OpenAI API, which lists every model type it hosts together. A custom
  // base URL (local Ollama, LM Studio, vLLM, a proxy) has its own naming —
  // "llama3.2" would otherwise get filtered out as "not chat-shaped".
  if (baseUrl) return ids.sort()
  return ids.filter((id) => OPENAI_CHAT_MODEL_PATTERN.test(id) && !NON_CHAT_MODEL_PATTERN.test(id)).sort()
}

interface AnthropicModelList {
  data?: { id: string }[]
}

export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const json = (await fetchJson('https://api.anthropic.com/v1/models', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  })) as AnthropicModelList
  return (json.data ?? []).map((m) => m.id).sort()
}

interface GoogleModelList {
  models?: { name: string; supportedGenerationMethods?: string[] }[]
}

export async function listGoogleModels(apiKey: string): Promise<string[]> {
  const json = (await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    {}
  )) as GoogleModelList
  return (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort()
}

export async function listGroqModels(apiKey: string): Promise<string[]> {
  const json = (await fetchJson('https://api.groq.com/openai/v1/models', {
    Authorization: `Bearer ${apiKey}`,
  })) as OpenAICompatibleModelList
  return (json.data ?? []).map((m) => m.id).sort()
}

export async function listMistralModels(apiKey: string): Promise<string[]> {
  const json = (await fetchJson('https://api.mistral.ai/v1/models', {
    Authorization: `Bearer ${apiKey}`,
  })) as OpenAICompatibleModelList
  return (json.data ?? []).map((m) => m.id).sort()
}

export const XAI_BASE_URL = 'https://api.x.ai/v1'

export async function listXaiModels(apiKey: string): Promise<string[]> {
  const json = (await fetchJson(`${XAI_BASE_URL}/models`, {
    Authorization: `Bearer ${apiKey}`,
  })) as OpenAICompatibleModelList
  return (json.data ?? []).map((m) => m.id).sort()
}

/**
 * Dispatch to the right provider's live model list. `openai-compatible`
 * (Ollama, LM Studio, vLLM, and any other custom endpoint) is best-effort —
 * many self-hosted runtimes don't implement `/v1/models` at all, so callers
 * must be ready for this to throw and fall back to letting the user type a
 * model ID by hand, which is already the default UI for that provider.
 */
export async function listModelsForProvider(
  provider: string,
  apiKey: string,
  baseUrl: string | null
): Promise<string[]> {
  switch (provider) {
    case 'anthropic':
      return listAnthropicModels(apiKey)
    case 'google':
      return listGoogleModels(apiKey)
    case 'groq':
      return listGroqModels(apiKey)
    case 'mistral':
      return listMistralModels(apiKey)
    case 'xai':
      return listXaiModels(apiKey)
    case 'openai-compatible':
      return listOpenAIModels(apiKey, baseUrl)
    default:
      return listOpenAIModels(apiKey, baseUrl)
  }
}
