'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { signOut } from '@/auth'
import { requireOrgAccess } from '@/lib/auth/org'
import { getOrg, getOrgDeletionStatus, softDeleteOrg, restoreOrg } from '@/lib/db/queries/orgs'
import { getSubscription } from '@/lib/db/queries/billing'
import { stripeConfigured } from '@/lib/billing/plans'
import { cancelSubscriptionImmediately } from '@/lib/billing/stripe'
import { logger } from '@/lib/logger'

// Only the owner can destroy the whole org — same class as transferring
// ownership, minting/revoking API keys, or removing a member.
const OWNER_ONLY = ['owner'] as const

const DeleteAccountSchema = z.object({
  confirmName: z.string().min(1),
})

export async function deleteAccountAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(OWNER_ONLY)
  if (!access.ok) return { error: access.error }

  const parsed = DeleteAccountSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Type your workspace name to confirm.' }

  const org = await getOrg(access.orgId)
  if (!org) return { error: 'Workspace not found.' }
  if (parsed.data.confirmName.trim() !== org.name) {
    return { error: 'That doesn’t match your workspace name. Nothing was deleted.' }
  }

  // Cancel billing before marking the org deleted, not after — if Stripe
  // fails, the owner still has access and can retry, rather than the org
  // being locked out with billing still running in the background.
  if (stripeConfigured()) {
    const subscription = await getSubscription(access.orgId)
    if (subscription?.stripeSubscriptionId) {
      try {
        await cancelSubscriptionImmediately(subscription.stripeSubscriptionId)
      } catch (err) {
        logger.error('Failed to cancel Stripe subscription during account deletion', {
          module: 'actions/account',
          orgId: access.orgId,
          error: err,
        })
        return { error: 'Could not cancel billing right now — please try again or contact support.' }
      }
    }
  }

  await softDeleteOrg(access.orgId)
  logger.warn('Account soft-deleted', { module: 'actions/account', orgId: access.orgId, userId: access.userId })

  refresh()
  await signOut({ redirectTo: '/login' })
  return null
}

export interface AccountDeletionInfo {
  orgName: string
  deletedAt: string
  purgeAt: string
  canRestore: boolean
}

/** Null if the caller's org isn't actually deleted (or the caller has no valid org at all). */
export async function getAccountDeletionInfo(): Promise<AccountDeletionInfo | null> {
  const access = await requireOrgAccess()
  if (!access.ok) return null

  const [org, status] = await Promise.all([getOrg(access.orgId), getOrgDeletionStatus(access.orgId)])
  if (!org || !status) return null

  return {
    orgName: org.name,
    deletedAt: status.deletedAt,
    purgeAt: status.purgeAt,
    canRestore: access.role === 'owner',
  }
}

/** For the Settings Danger Zone confirm-by-name input — null if the caller has no valid org. */
export async function getCurrentOrgName(): Promise<string | null> {
  const access = await requireOrgAccess()
  if (!access.ok) return null
  const org = await getOrg(access.orgId)
  return org?.name ?? null
}

export async function restoreAccountAction(): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(OWNER_ONLY)
  if (!access.ok) return { error: access.error }

  const status = await getOrgDeletionStatus(access.orgId)
  if (!status) return { error: 'This workspace is not scheduled for deletion.' }

  await restoreOrg(access.orgId)
  logger.info('Account deletion reversed by owner', { module: 'actions/account', orgId: access.orgId, userId: access.userId })

  refresh()
  return null
}
