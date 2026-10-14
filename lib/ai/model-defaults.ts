// Platform default model IDs — the fallback used when an org has no AI
// provider configured (or no override for that call site), and when the
// hosting platform doesn't set PLATFORM_AI_*_MODEL (lib/ai/platform-models.ts).
// Centralized here so bumping a default means editing one constant, not
// hunting through every chatModel()/embeddingModel() call site across lib/ai,
// lib/agent, and the API routes that use them. Kept in its own module so
// platform-models.ts can read them without importing models.ts.
export const DEFAULT_CHAT_MODEL = 'gpt-5.6-terra'
export const DEFAULT_FAST_MODEL = 'gpt-5.6-luna'
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
