'use server'

import { requireOrgAccess } from '@/lib/auth/org'
import { rateLimitShared } from '@/lib/ratelimit'
import { retitleStatus, runRetitlePass } from '@/lib/kb/retitle-imports'
import { logger } from '@/lib/logger'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'

const MOD = 'actions/kb-retitle'

// Re-processing every imported page spends the workspace's own embedding key,
// so it is an owner or admin decision, the same as the AI Model settings.
const RETITLE_ROLES = ['owner', 'admin'] as const

// Pages per call: small enough to return quickly and show progress, while the
// page keeps calling until every page is done.
const PAGES_PER_CALL = 10
// Enough calls for one click to finish a workspace at the article cap; the
// pass's lease already stops two runs overlapping, so this only bounds abuse.
const CALLS_PER_WINDOW = Math.ceil(MAX_ARTICLES_PER_ORG / PAGES_PER_CALL)

export type RetitleRunResult = { ok: true; retitled: number; remainingSources: number } | { ok: false; error: string }

/** Whether "Update imported page titles" applies to this workspace, and how many pages are waiting. Nothing for anyone else. */
export async function retitleStatusAction(): Promise<{ eligibleForOwnerRun: boolean; remainingSources: number }> {
  const access = await requireOrgAccess(RETITLE_ROLES)
  if (!access.ok) return { eligibleForOwnerRun: false, remainingSources: 0 }
  return retitleStatus(access.orgId)
}

/** Runs one bounded slice of the re-title pass on the workspace's own embedding key (lib/kb/retitle-imports.ts). */
export async function runRetitleAction(): Promise<RetitleRunResult> {
  const access = await requireOrgAccess(RETITLE_ROLES)
  if (!access.ok) return { ok: false, error: access.error }
  const limit = await rateLimitShared(`kb-retitle:${access.orgId}`, CALLS_PER_WINDOW, 10 * 60_000)
  if (!limit.ok) {
    const mins = Math.max(1, Math.ceil(limit.retryAfterMs / 60_000))
    return { ok: false, error: `Too many updates at once. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }
  }
  try {
    const result = await runRetitlePass(access.orgId, { mode: 'owner', maxSources: PAGES_PER_CALL })
    if (result.skipped === 'busy') return { ok: false, error: 'An update is already running. Try again in a few minutes.' }
    if (result.skipped === 'migrating') {
      return { ok: false, error: 'Your knowledge base is moving to a new embedding model. Try again once that has finished.' }
    }
    if (result.skipped === 'not-eligible') return { ok: false, error: 'Titles for this workspace are updated automatically.' }
    return { ok: true, retitled: result.retitled, remainingSources: result.remainingSources }
  } catch (error) {
    logger.warn('re-title action failed', { module: MOD, orgId: access.orgId, error })
    return { ok: false, error: 'The update stopped partway. Check your embedding key in Settings → AI Model, then try again.' }
  }
}
