import { openai } from '@ai-sdk/openai'
import { wrapEmbeddingModel } from 'ai'
import { hasPrice } from '@/lib/ai/pricing'
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL, DEFAULT_FAST_MODEL } from '@/lib/ai/model-defaults'
import { logger } from '@/lib/logger'

const MOD = 'ai/platform-models'

type EmbeddingModelV3 = Parameters<typeof wrapEmbeddingModel>[0]['model']

/**
 * The models answerLoops runs on its own key, set on the hosting platform so
 * they can change without a release; unset falls back to the code defaults.
 * A workspace without its own key always gets these. Models it may have saved
 * are only used with its own key.
 */
export type PlatformRole = 'chat' | 'fast' | 'embedding'

export const PLATFORM_MODEL_ENV_VARS: Readonly<Record<PlatformRole, string>> = {
  chat: 'PLATFORM_AI_CHAT_MODEL',
  fast: 'PLATFORM_AI_FAST_MODEL',
  embedding: 'PLATFORM_AI_EMBEDDING_MODEL',
}

const DEFAULTS: Record<PlatformRole, string> = {
  chat: DEFAULT_CHAT_MODEL,
  fast: DEFAULT_FAST_MODEL,
  embedding: DEFAULT_EMBEDDING_MODEL,
}

const ROLES: readonly PlatformRole[] = ['chat', 'fast', 'embedding']

/**
 * Dimension of kb_articles.embedding_vec (lib/db/schema.ts), fixed
 * platform-wide so a single pgvector index can cover every org regardless
 * of which embedding_model an org has configured. An org that configures a
 * model producing a different size gets a hard failure creating KB articles
 * (Postgres rejects a wrong-length insert into a vector(1536) column) rather
 * than a silently-unindexed article.
 */
export const KB_EMBEDDING_DIMENSIONS = 1536

const NATIVE_1536 = new Set(['text-embedding-3-small', 'text-embedding-ada-002'])
const DIMENSIONS_PARAM = new Set(['text-embedding-3-large'])

/** Whether a model can fill the KB vector column: natively, via the `dimensions` option, or not at all. */
export function embeddingDimensionsSupported(modelId: string): 'native' | 'param' | false {
  if (NATIVE_1536.has(modelId)) return 'native'
  if (DIMENSIONS_PARAM.has(modelId)) return 'param'
  return false
}

export function readPlatformModels(env: Readonly<Record<string, string | undefined>> = process.env): Record<PlatformRole, string | null> {
  const out = { chat: null, fast: null, embedding: null } as Record<PlatformRole, string | null>
  for (const role of ROLES) {
    const raw = env[PLATFORM_MODEL_ENV_VARS[role]]?.trim()
    const id = raw ? raw : DEFAULTS[role]
    const isEmbedding = embeddingDimensionsSupported(id) !== false
    const usable = hasPrice(id) && (role === 'embedding' ? isEmbedding : !isEmbedding)
    out[role] = usable ? id : null
  }
  return out
}

let cached: Record<PlatformRole, string | null> | null = null

/** The platform model for a role, or null when the configured model can't be metered or used for it. */
export function getPlatformModel(role: PlatformRole): string | null {
  if (!cached) {
    cached = readPlatformModels(process.env)
    for (const r of ROLES) {
      if (cached[r] === null) {
        logger.error('platform AI model is unpriced or unsupported; that role is off', { module: MOD, role: r, variable: PLATFORM_MODEL_ENV_VARS[r] })
      }
    }
  }
  return cached[role]
}

export function resetPlatformModelsCache(): void {
  cached = null
}

/** Triage, grading and the widget ask for the fast default; everything else gets the chat model. */
export function roleForDefault(defaultId: string): 'chat' | 'fast' {
  return defaultId === DEFAULT_FAST_MODEL ? 'fast' : 'chat'
}

/** Asks an OpenAI embedding model for vectors sized to the KB column. */
export function withKbDimensions(model: EmbeddingModelV3): EmbeddingModelV3 {
  return wrapEmbeddingModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: { ...(params.providerOptions?.openai ?? {}), dimensions: KB_EMBEDDING_DIMENSIONS },
        },
      }),
    },
  })
}

/** The platform embedding model, sized to the KB vector column. */
export function platformEmbedding(modelId: string): EmbeddingModelV3 {
  const base = openai.embedding(modelId)
  return embeddingDimensionsSupported(modelId) === 'param' ? withKbDimensions(base) : base
}
