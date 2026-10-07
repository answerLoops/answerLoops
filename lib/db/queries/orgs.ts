import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import {
  orgs,
  memberships,
  tickets,
  ticketReplies,
  ticketEvents,
  ticketEmbeddings,
  ticketLinks,
  ticketFeedback,
  answerMessages,
  aiAssessments,
  csatMessages,
  csatRatings,
  githubRepos,
  kbSyncJobs,
  discordGuilds,
  faqSnapshots,
  notifications,
  pushSubscriptions,
  kbSources,
  kbArticles,
  integrations,
  emailMessages,
  invitations,
  aiConfigs,
  subscriptions,
  widgetLeads,
  productFeedback,
  apiKeys,
  apiGenerations,
  emailDomains,
  emailOauthConnections,
  notionConnections,
  orgFeatureFlags,
} from '../schema'

// How long a soft-deleted org's data survives before the background sweep
// (see hardPurgeOrg / getOrgsPendingPurge) permanently deletes it. Matches
// the industry-standard grace-period pattern (Stripe cancel-at-period-end,
// GitHub's repo-deletion delay) — long enough to undo an accidental or
// impulsive deletion, short enough that "deleted" isn't a lie.
export const ORG_PURGE_GRACE_DAYS = 30

export interface Org {
  id: number
  name: string
  slug: string | null
  onboarded_at: string | null
  widget_token: string | null
  widget_token_expires_at: string | null
  created_at: string
}

export async function getOrg(orgId: number): Promise<Org | null> {
  const db = getDb()
  const [row] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1)
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    onboarded_at: row.onboardedAt,
    widget_token: row.widgetToken,
    widget_token_expires_at: row.widgetTokenExpiresAt,
    created_at: row.createdAt,
  }
}

export async function updateOrgName(orgId: number, name: string): Promise<void> {
  await getDb().update(orgs).set({ name }).where(eq(orgs.id, orgId))
}

export async function setOrgOnboarded(orgId: number): Promise<void> {
  await getDb()
    .update(orgs)
    .set({ onboardedAt: new Date().toISOString() })
    .where(eq(orgs.id, orgId))
}

export async function getOrgROIConfig(orgId: number): Promise<{ minutesPerTicket: number | null; staffHourlyRate: number | null }> {
  const [row] = await getDb()
    .select({ roiMinutesPerTicket: orgs.roiMinutesPerTicket, roiStaffHourlyRate: orgs.roiStaffHourlyRate })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  return {
    minutesPerTicket: row?.roiMinutesPerTicket ?? null,
    staffHourlyRate: row?.roiStaffHourlyRate ?? null,
  }
}

export async function saveOrgROIConfig(orgId: number, minutesPerTicket: number, staffHourlyRate: number): Promise<void> {
  await getDb()
    .update(orgs)
    .set({ roiMinutesPerTicket: minutesPerTicket, roiStaffHourlyRate: staffHourlyRate })
    .where(eq(orgs.id, orgId))
}

export interface OrgDeletionStatus {
  deletedAt: string
  purgeAt: string
}

/** NULL deletedAt (the common case) returns null — org is active. */
export async function getOrgDeletionStatus(orgId: number): Promise<OrgDeletionStatus | null> {
  const [row] = await getDb()
    .select({ deletedAt: orgs.deletedAt })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  if (!row?.deletedAt) return null
  const deletedAt = new Date(row.deletedAt)
  const purgeAt = new Date(deletedAt.getTime() + ORG_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000)
  return { deletedAt: deletedAt.toISOString(), purgeAt: purgeAt.toISOString() }
}

/** Marks the org for deletion. Access is revoked the moment this is set — see requireOrgAccess. */
export async function softDeleteOrg(orgId: number): Promise<void> {
  await getDb().update(orgs).set({ deletedAt: new Date() }).where(eq(orgs.id, orgId))
}

/** Undoes a soft delete within the grace period. No-op (not an error) if the org was never deleted. */
export async function restoreOrg(orgId: number): Promise<void> {
  await getDb().update(orgs).set({ deletedAt: null }).where(eq(orgs.id, orgId))
}

/** Org ids whose grace period has fully elapsed — ready for hardPurgeOrg. */
export async function getOrgsPendingPurge(): Promise<number[]> {
  const cutoff = new Date(Date.now() - ORG_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000)
  const rows = await getDb()
    .select({ id: orgs.id })
    .from(orgs)
    .where(and(isNotNull(orgs.deletedAt), lt(orgs.deletedAt, cutoff)))
  return rows.map((r) => r.id)
}

/**
 * Permanently deletes an org and every row that depends on it. Irreversible —
 * only ever call this on an org id returned by getOrgsPendingPurge (grace
 * period already elapsed), never directly from a user-facing action.
 *
 * Deletion order matters: several tables have no ON DELETE CASCADE/SET NULL
 * at the DB level (kbArticles.sourceTicketId, csatRatings/notifications/
 * apiGenerations' FKs), so a child row must be deleted before the parent it
 * references or Postgres rejects the delete with a foreign-key violation.
 * Wrapped in one transaction so a failure partway through can't leave the
 * org half-purged.
 *
 * users rows are deliberately untouched — a Google-auth identity isn't
 * org-scoped data, and if the same person signs in again auth.ts's
 * provisionUser just creates them a fresh org.
 */
export async function hardPurgeOrg(orgId: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    const ticketIdRows = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.orgId, orgId))
    const ticketIds = ticketIdRows.map((r) => r.id)

    // Org+ticket-scoped rows that reference tickets with no cascade/set-null
    // action — must go before the tickets themselves.
    await tx.delete(kbArticles).where(eq(kbArticles.orgId, orgId))
    await tx.delete(notifications).where(eq(notifications.orgId, orgId))
    await tx.delete(csatRatings).where(eq(csatRatings.orgId, orgId))
    await tx.delete(apiGenerations).where(eq(apiGenerations.orgId, orgId))
    await tx.delete(emailMessages).where(eq(emailMessages.orgId, orgId))

    if (ticketIds.length > 0) {
      await tx.delete(ticketReplies).where(inArray(ticketReplies.ticketId, ticketIds))
      await tx.delete(ticketEvents).where(inArray(ticketEvents.ticketId, ticketIds))
      await tx.delete(ticketEmbeddings).where(inArray(ticketEmbeddings.ticketId, ticketIds))
      await tx.delete(ticketLinks).where(inArray(ticketLinks.ticketId, ticketIds))
      await tx.delete(ticketLinks).where(inArray(ticketLinks.relatedId, ticketIds))
      await tx.delete(ticketFeedback).where(inArray(ticketFeedback.ticketId, ticketIds))
      await tx.delete(answerMessages).where(inArray(answerMessages.ticketId, ticketIds))
      await tx.delete(aiAssessments).where(inArray(aiAssessments.ticketId, ticketIds))
      await tx.delete(csatMessages).where(inArray(csatMessages.ticketId, ticketIds))
    }

    await tx.delete(tickets).where(eq(tickets.orgId, orgId))

    // Org-scoped rows with no ticket dependency.
    await tx.delete(kbSyncJobs).where(eq(kbSyncJobs.orgId, orgId))
    await tx.delete(githubRepos).where(eq(githubRepos.orgId, orgId))
    await tx.delete(discordGuilds).where(eq(discordGuilds.orgId, orgId))
    await tx.delete(faqSnapshots).where(eq(faqSnapshots.orgId, orgId))
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.orgId, orgId))
    await tx.delete(kbSources).where(eq(kbSources.orgId, orgId))
    await tx.delete(integrations).where(eq(integrations.orgId, orgId))
    await tx.delete(invitations).where(eq(invitations.orgId, orgId))
    await tx.delete(aiConfigs).where(eq(aiConfigs.orgId, orgId))
    await tx.delete(subscriptions).where(eq(subscriptions.orgId, orgId))
    await tx.delete(widgetLeads).where(eq(widgetLeads.orgId, orgId))
    // The author's workspace is gone, so its feedback-board entries go with it
    // — even approved ones, which are otherwise visible to every workspace.
    await tx.delete(productFeedback).where(eq(productFeedback.orgId, orgId))
    await tx.delete(apiKeys).where(eq(apiKeys.orgId, orgId))
    await tx.delete(emailDomains).where(eq(emailDomains.orgId, orgId))
    await tx.delete(emailOauthConnections).where(eq(emailOauthConnections.orgId, orgId))
    await tx.delete(notionConnections).where(eq(notionConnections.orgId, orgId))
    await tx.delete(orgFeatureFlags).where(eq(orgFeatureFlags.orgId, orgId))
    await tx.delete(memberships).where(eq(memberships.orgId, orgId))

    // Widget chat transcripts live in Mastra-managed tables (see
    // lib/ai/memory.ts), outside the Drizzle schema — so nothing above
    // reaches them, and the schema-derived completeness check in
    // tests/unit/org-purge-completeness.test.ts is structurally blind to
    // them (they carry no org_id column). Thread ids are
    // `widget:<orgId>:<visitorId>`, which is what makes an org's rows
    // identifiable here at all.
    //
    // Existence is checked separately rather than inline in a DO block:
    // a DO body is a string literal to the server, so it cannot carry bind
    // parameters, and the org id has to be bound rather than interpolated.
    // Mastra creates these tables lazily on first widget use, so an org
    // that never embedded the widget has none of them — an unguarded DELETE
    // would throw and roll back this entire transaction, turning a missing
    // cleanup into a total purge failure, which is the exact class of bug
    // this function is being fixed for.
    const threadPrefix = `widget:${orgId}:%`
    const present = (await tx.execute(sql`
      SELECT to_regclass('public.mastra_messages') IS NOT NULL AS has_messages,
             to_regclass('public.mastra_threads')  IS NOT NULL AS has_threads
    `)) as unknown as { has_messages: boolean; has_threads: boolean }[]

    if (present[0]?.has_messages) {
      await tx.execute(sql`DELETE FROM mastra_messages WHERE thread_id LIKE ${threadPrefix}`)
    }
    if (present[0]?.has_threads) {
      await tx.execute(sql`DELETE FROM mastra_threads WHERE id LIKE ${threadPrefix}`)
    }

    await tx.delete(orgs).where(eq(orgs.id, orgId))
  })
}
