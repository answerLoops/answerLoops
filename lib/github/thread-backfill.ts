import { and, eq, isNull, like, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { githubRepos, ticketReplies, tickets } from '@/lib/db/schema'
import { deleteTicket, getTicketByThreadId } from '@/lib/db/queries/tickets'
import { getInstallationOctokitById } from '@/lib/github/app'
import { githubThreadId } from '@/lib/ingest/thread-keys'

// Before comments were threaded, every GitHub comment opened a ticket of its
// own and nothing recorded which issue it belonged to. This moves those
// orphans into the conversation they came from: the comment becomes a message
// on the issue's ticket and the stand-alone ticket goes away. Every step is
// scoped to one organization, and a comment whose issue has no ticket in that
// organization is left exactly as it was.

const ISSUE_COMMENT_PREFIX = 'github-issue-comment-'
const DISCUSSION_COMMENT_PREFIX = 'github-discussion-comment-'

export interface CommentRef {
  owner: string
  repo: string
  commentId: string
  kind: 'issue' | 'discussion'
}

/** Finds the number of the issue or discussion a comment sits under, or null if it cannot be found. */
export type ResolveParentNumber = (ref: CommentRef) => Promise<number | null>

export interface BackfillSummary {
  /** Comment tickets folded into their issue's ticket. */
  attached: number
  /** Would have been attached; counted instead of changed on a dry run. */
  wouldAttach: number
  /** The issue or discussion has no ticket in this organization. */
  noParentTicket: number
  /** The comment's number could not be looked up (deleted comment, no access, discussion comment). */
  unresolved: number
  /** Staff or answerLoops already replied on the comment ticket; folding it in would lose those replies. */
  hasReplies: number
}

/**
 * Parses a comment ticket's source message id. The owner and repo are taken
 * from the ticket's channel (`owner/repo`) rather than split out of the id,
 * because both can contain hyphens.
 */
export function parseCommentTicket(sourceMessageId: string, channelId: string | null): CommentRef | null {
  const slash = channelId?.indexOf('/') ?? -1
  if (!channelId || slash < 1 || slash === channelId.length - 1) return null
  const owner = channelId.slice(0, slash)
  const repo = channelId.slice(slash + 1)
  for (const [prefix, kind] of [[ISSUE_COMMENT_PREFIX, 'issue'], [DISCUSSION_COMMENT_PREFIX, 'discussion']] as const) {
    const head = `${prefix}${owner}-${repo}-`
    if (!sourceMessageId.startsWith(head)) continue
    const commentId = sourceMessageId.slice(head.length)
    if (!/^\d+$/.test(commentId)) return null
    return { owner, repo, commentId, kind }
  }
  return null
}

export async function backfillGithubCommentThreads(
  orgId: number,
  resolveParentNumber: ResolveParentNumber,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<BackfillSummary> {
  const db = getDb()
  const summary: BackfillSummary = { attached: 0, wouldAttach: 0, noParentTicket: 0, unresolved: 0, hasReplies: 0 }

  const orphans = await db
    .select({
      id: tickets.id,
      content: tickets.content,
      sourceMessageId: tickets.sourceMessageId,
      sourceChannelId: tickets.sourceChannelId,
      sourceAuthorName: tickets.sourceAuthorName,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(and(
      eq(tickets.orgId, orgId),
      eq(tickets.sourcePlatform, 'github'),
      isNull(tickets.sourceThreadId),
      or(
        like(tickets.sourceMessageId, `${ISSUE_COMMENT_PREFIX}%`),
        like(tickets.sourceMessageId, `${DISCUSSION_COMMENT_PREFIX}%`)
      )
    ))
    .orderBy(tickets.createdAt)

  for (const orphan of orphans) {
    const ref = orphan.sourceMessageId ? parseCommentTicket(orphan.sourceMessageId, orphan.sourceChannelId) : null
    const parentNumber = ref ? await resolveParentNumber(ref).catch(() => null) : null
    if (!ref || parentNumber === null) {
      summary.unresolved++
      continue
    }

    const parent = await getTicketByThreadId(githubThreadId(ref.owner, ref.repo, ref.kind, parentNumber), orgId)
    if (!parent || parent.id === orphan.id) {
      summary.noParentTicket++
      continue
    }

    // Deleting the comment ticket removes its own replies with it, so one
    // that someone already answered stays a ticket.
    const [reply] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ticketReplies)
      .where(eq(ticketReplies.ticketId, orphan.id))
    if ((reply?.n ?? 0) > 0) {
      summary.hasReplies++
      continue
    }

    if (dryRun) {
      summary.wouldAttach++
      continue
    }

    // Insert first, delete second: if the run stops in between, the next run
    // finds the message already stored (unique per ticket and message id) and
    // finishes the delete.
    await db
      .insert(ticketReplies)
      .values({
        ticketId: parent.id,
        staffName: orphan.sourceAuthorName ?? 'Customer',
        content: orphan.content,
        authorRole: 'customer',
        sourceMessageId: orphan.sourceMessageId,
        createdAt: orphan.createdAt,
      })
      .onConflictDoNothing()
    await deleteTicket(orphan.id)
    summary.attached++
  }

  return summary
}

/**
 * Looks issue comments up through the organization's own GitHub installation.
 * Discussion comments cannot be looked up by their numeric id, so they resolve
 * to null and are reported rather than guessed at.
 */
export function githubParentResolver(orgId: number): ResolveParentNumber {
  const installations = new Map<string, number | null>()
  return async ({ owner, repo, commentId, kind }) => {
    if (kind !== 'issue') return null
    const key = `${owner}/${repo}`
    if (!installations.has(key)) {
      const [row] = await getDb()
        .select({ installationId: githubRepos.installationId })
        .from(githubRepos)
        .where(and(eq(githubRepos.orgId, orgId), eq(githubRepos.owner, owner), eq(githubRepos.repo, repo)))
        .limit(1)
      installations.set(key, row?.installationId ?? null)
    }
    const installationId = installations.get(key)
    if (installationId == null) return null
    const octokit = await getInstallationOctokitById(installationId)
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner,
      repo,
      comment_id: Number(commentId),
    })
    const number = /\/issues\/(\d+)$/.exec(data.issue_url)?.[1]
    return number ? Number(number) : null
  }
}
