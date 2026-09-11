import { eq } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { aiConfigs } from '../schema'
import { encryptToken, decryptToken } from '@/lib/crypto/tokens'

export interface OrgAIConfig {
  id: number
  org_id: number
  chat_provider: string
  chat_model: string
  chat_api_key: string | null
  chat_base_url: string | null
  embedding_provider: string
  embedding_model: string
  embedding_api_key: string | null
  embedding_base_url: string | null
}

function toConfig(row: typeof aiConfigs.$inferSelect): OrgAIConfig {
  return {
    id: row.id,
    org_id: row.orgId,
    chat_provider: row.chatProvider,
    chat_model: row.chatModel,
    chat_api_key: row.chatApiKey ? decryptToken(row.chatApiKey) : null,
    chat_base_url: row.chatBaseUrl,
    embedding_provider: row.embeddingProvider,
    embedding_model: row.embeddingModel,
    embedding_api_key: row.embeddingApiKey ? decryptToken(row.embeddingApiKey) : null,
    embedding_base_url: row.embeddingBaseUrl,
  }
}

export async function getOrgAIConfig(orgId: number): Promise<OrgAIConfig | null> {
  try {
    const [row] = await getDb()
      .select()
      .from(aiConfigs)
      .where(eq(aiConfigs.orgId, orgId))
      .limit(1)
    return row ? toConfig(row) : null
  } catch {
    return null
  }
}

// Same "does this org actually have a usable key" condition chatModel()
// uses internally (lib/ai/models.ts) — centralized here so the platform-key
// trial gate and any other caller can't drift from what models.ts itself
// treats as "configured".
export async function orgHasAIKey(orgId: number): Promise<boolean> {
  const cfg = await getOrgAIConfig(orgId)
  return !!(cfg?.chat_api_key || cfg?.chat_provider === 'openai-compatible')
}

export async function saveOrgAIConfig(
  orgId: number,
  config: {
    chat_provider: string
    chat_model: string
    chat_api_key?: string | null
    chat_base_url?: string | null
    embedding_provider: string
    embedding_model: string
    embedding_api_key?: string | null
    embedding_base_url?: string | null
    // Drop the stored key rather than keeping it — used when the provider
    // changed and the caller intentionally left the key field blank (only
    // valid for a keyless openai-compatible endpoint).
    clear_chat_api_key?: boolean
    clear_embedding_api_key?: boolean
  }
): Promise<void> {
  const now = new Date().toISOString()
  const encChatKey = config.chat_api_key ? encryptToken(config.chat_api_key) : null
  const encEmbedKey = config.embedding_api_key ? encryptToken(config.embedding_api_key) : null
  // On an update: undefined = leave as-is, null = wipe, a value = overwrite.
  const chatKeyUpdate =
    encChatKey !== null ? { chatApiKey: encChatKey } : config.clear_chat_api_key ? { chatApiKey: null } : {}
  const embedKeyUpdate =
    encEmbedKey !== null ? { embeddingApiKey: encEmbedKey } : config.clear_embedding_api_key ? { embeddingApiKey: null } : {}

  await getDb()
    .insert(aiConfigs)
    .values({
      orgId,
      chatProvider: config.chat_provider,
      chatModel: config.chat_model,
      chatApiKey: encChatKey,
      chatBaseUrl: config.chat_base_url ?? null,
      embeddingProvider: config.embedding_provider,
      embeddingModel: config.embedding_model,
      embeddingApiKey: encEmbedKey,
      embeddingBaseUrl: config.embedding_base_url ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiConfigs.orgId,
      set: {
        chatProvider: config.chat_provider,
        chatModel: config.chat_model,
        ...chatKeyUpdate,
        chatBaseUrl: config.chat_base_url ?? null,
        embeddingProvider: config.embedding_provider,
        embeddingModel: config.embedding_model,
        ...embedKeyUpdate,
        embeddingBaseUrl: config.embedding_base_url ?? null,
        updatedAt: now,
      },
    })
}

export async function deleteOrgAIConfig(orgId: number): Promise<void> {
  await getDb().delete(aiConfigs).where(eq(aiConfigs.orgId, orgId))
}
