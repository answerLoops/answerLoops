'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { saveOrgAIConfig, deleteOrgAIConfig, getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { PLANS } from '@/lib/billing/plans'
import { testAIProviderConnection, type AIConnectionResult } from '@/lib/ai/test-connection'
import { validateAIConfig } from '@/lib/ai/config-validation'

const CHAT_PROVIDERS = ['openai', 'anthropic', 'google', 'groq', 'mistral', 'openai-compatible'] as const
const EMBEDDING_PROVIDERS = ['openai', 'openai-compatible'] as const

const SaveSchema = z.object({
  chat_provider: z.enum(CHAT_PROVIDERS),
  chat_model: z.string().min(1).max(200),
  chat_api_key: z.string().max(500).optional(),
  chat_base_url: z.string().url().max(500).optional().or(z.literal('')),
  embedding_provider: z.enum(EMBEDDING_PROVIDERS),
  embedding_model: z.string().min(1).max(200),
  embedding_api_key: z.string().max(500).optional(),
  embedding_base_url: z.string().url().max(500).optional().or(z.literal('')),
})

async function resolveOrgForAIConfig() {
  // The org's model provider + API keys are org-wide credentials — same
  // sensitivity class as API keys and ownership transfer, so owner/admin only,
  // resolved from a real membership row (never a default-org fallback).
  return requireOrgAccess(['owner', 'admin'])
}

export async function saveAIConfigAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await resolveOrgForAIConfig()
  if (!access.ok) return { error: access.error }
  const { orgId } = access

  const parsed = SaveSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const d = parsed.data

  const existing = await getOrgAIConfig(orgId)

  const validationError = validateAIConfig(d, existing)
  if (validationError) return { error: validationError }

  // Bring-your-own-key with a named provider is included on every plan. Only an
  // arbitrary custom endpoint ('openai-compatible') is the Enterprise-gated
  // "Custom AI model configuration" row.
  const isCustomEndpoint = d.chat_provider === 'openai-compatible' || d.embedding_provider === 'openai-compatible'
  if (isCustomEndpoint && !(await orgHasFeature(orgId, 'custom_ai_model_config'))) {
    const requiredPlan = planRequiredFor('custom_ai_model_config')
    return { error: `Custom AI model configuration is available on the ${PLANS[requiredPlan].name} plan and above.` }
  }

  // When the provider changed and the key field was left blank (only reachable
  // for a keyless openai-compatible endpoint after validation), wipe the stale
  // key rather than carrying the old provider's credential forward.
  const clearChatKey =
    !!existing && existing.chat_provider !== d.chat_provider && !d.chat_api_key
  const clearEmbeddingKey =
    !!existing && existing.embedding_provider !== d.embedding_provider && !d.embedding_api_key

  await saveOrgAIConfig(orgId, {
    chat_provider: d.chat_provider,
    chat_model: d.chat_model,
    chat_api_key: d.chat_api_key || null,
    chat_base_url: d.chat_base_url || null,
    embedding_provider: d.embedding_provider,
    embedding_model: d.embedding_model,
    embedding_api_key: d.embedding_api_key || null,
    embedding_base_url: d.embedding_base_url || null,
    clear_chat_api_key: clearChatKey,
    clear_embedding_api_key: clearEmbeddingKey,
  })

  return null
}

export async function clearAIConfigAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const access = await resolveOrgForAIConfig()
  if (!access.ok) return { error: access.error }

  await deleteOrgAIConfig(access.orgId)
  return null
}

/**
 * Run a live check against the entered credentials without saving. A blank key
 * field means "use the one already stored" — same semantics as save.
 */
export async function testAIConfigAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; result?: AIConnectionResult }> {
  const access = await resolveOrgForAIConfig()
  if (!access.ok) return { error: access.error }

  const parsed = SaveSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Fill in the form first' }
  const d = parsed.data

  const existing = await getOrgAIConfig(access.orgId)

  const result = await testAIProviderConnection({
    chatProvider: d.chat_provider,
    chatModel: d.chat_model,
    chatApiKey: d.chat_api_key || existing?.chat_api_key || null,
    chatBaseUrl: d.chat_base_url || existing?.chat_base_url || null,
    embeddingProvider: d.embedding_provider,
    embeddingModel: d.embedding_model,
    embeddingApiKey:
      d.embedding_api_key ||
      existing?.embedding_api_key ||
      // OpenAI embeddings inherit the OpenAI chat key, matching lib/ai/models.ts
      (d.embedding_provider === 'openai' && d.chat_provider === 'openai'
        ? d.chat_api_key || existing?.chat_api_key || null
        : null),
    embeddingBaseUrl: d.embedding_base_url || existing?.embedding_base_url || null,
  })

  return { result }
}
