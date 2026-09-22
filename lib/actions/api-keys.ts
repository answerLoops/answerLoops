'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { requireOrgAccess } from '@/lib/auth/org'
import { createApiKey, revokeApiKey } from '@/lib/db/queries/api-keys'
import { isApiScope } from '@/lib/agent/scopes'

// An API key is an org-wide, long-lived credential: it grants read access to
// the org's entire ticket history and KB plus metered LLM spend, through both
// the MCP server and the Agent REST API. Minting or destroying one is an
// owner/admin action, in the same class as transferring ownership or removing
// a member — not something any member should be able to do.
const KEY_ADMIN_ROLES = ['owner', 'admin'] as const

// '' (never) maps to no expiry; the other values are day counts.
const CreateKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  expiresInDays: z.enum(['', '30', '90', '365']).optional(),
})

// Scopes arrive as repeated `scopes` form fields, so they're read with
// getAll() rather than through the object schema above. An empty selection
// means "full access" (createApiKey / normalizeScopes enforce that) — the
// UI defaults every box checked, so this is only hit if someone unchecks
// them all.
function readScopes(formData: FormData): string[] {
  return formData
    .getAll('scopes')
    .filter((v): v is string => typeof v === 'string' && isApiScope(v))
}

export async function createApiKeyAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; plaintextKey?: string } | null> {
  const access = await requireOrgAccess(KEY_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const parsed = CreateKeySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const expiresInDays = parsed.data.expiresInDays ? Number(parsed.data.expiresInDays) : null

  // The form always renders the scope checkboxes (all checked by default), so
  // a submission with none is a user who unchecked everything — treat that as
  // a mistake and fail closed rather than silently minting a full-access key
  // (which is what createApiKey(null) / normalizeScopes([]) would do). The
  // `scopes` field is absent entirely only for a non-form / legacy caller.
  const scopes = formData.has('scopes') ? readScopes(formData) : null
  if (scopes !== null && scopes.length === 0) {
    return { error: 'Select at least one permission for this key.' }
  }

  let plaintextKey: string
  try {
    ;({ plaintextKey } = await createApiKey(access.orgId, parsed.data.name, expiresInDays, scopes))
  } catch (err) {
    // createApiKey throws when the org is at its active-key cap — surface
    // that as a form error instead of a 500.
    return { error: err instanceof Error ? err.message : 'Failed to create key' }
  }
  refresh()
  // Plaintext is returned once — the UI must show it now, it can never be fetched again.
  return { plaintextKey }
}

const RevokeKeySchema = z.object({
  keyId: z.coerce.number(),
})

export async function revokeApiKeyAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(KEY_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const parsed = RevokeKeySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  await revokeApiKey(access.orgId, parsed.data.keyId)
  refresh()
  return null
}
