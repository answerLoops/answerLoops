import { type NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getRepoByOwnerAndName } from '@/lib/db/queries/github'
import { enqueueKbSyncJob } from '@/lib/db/queries/kb-sync-jobs'
import { processCommunityMessage, recordThreadContextMessage } from '@/lib/ingest/pipeline'
import { githubThreadId } from '@/lib/ingest/thread-keys'
import { getTicketByThreadId } from '@/lib/db/queries/tickets'
import { syncSingleDiscussionToKB } from '@/lib/github/kb-sync'
import { getInstallationOctokitById } from '@/lib/github/app'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { isIngestRateLimited, WEBHOOK_MAX_BODY_BYTES } from '@/lib/ingest/limits'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/github/webhook'

const GITHUB_MAX_BODY_BYTES = 5 * WEBHOOK_MAX_BODY_BYTES

// Minimum gap between knowledge-base re-syncs of one repo triggered by pushes.
// A push that lands inside the window still produces a sync, queued to start
// when the window ends; further pushes until then fold into that queued job.
// A push that arrives while a sync is running queues one follow-up run.
const PUSH_SYNC_COOLDOWN_MS = 2 * 60 * 1000

// Repo owners/members/collaborators filing an issue are doing work tracking,
// not asking for help — ingesting those inflates the staff queue and skews
// the deflection metric with tickets that were never deflectable. GitHub
// already resolves this per-author on every issue/comment/discussion payload
// (no extra API call needed), so anyone with write access or org membership
// is treated as internal and skipped.
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

function isMaintainerAuthored(authorAssociation: string | undefined): boolean {
  return !!authorAssociation && MAINTAINER_ASSOCIATIONS.has(authorAssociation)
}

function verifySignature(body: string, sig: string, secret: string): boolean {
  try {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    if (sig.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = (process.env.GITHUB_WEBHOOK_SECRET ?? '').trim()
  const sig = req.headers.get('x-hub-signature-256') ?? ''
  const event = req.headers.get('x-github-event') ?? ''
  // GitHub caps webhook payloads at 25 MB; 5 MB comfortably covers the push,
  // issue and discussion events handled here. Counted in bytes as it streams.
  const body = await readBodyCapped(req, GITHUB_MAX_BODY_BYTES)
  if (body === null) return NextResponse.json({ error: 'payload too large' }, { status: 413 })

  // Every delivery must carry a signature this server can verify against a
  // configured secret. A missing secret is a deployment error, not a reason
  // to accept unverified payloads — fail closed.
  if (!secret) {
    logger.error('github webhook rejected — GITHUB_WEBHOOK_SECRET is not set', { module: MOD })
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  if (!verifySignature(body, sig, secret)) {
    logger.warn('github webhook signature mismatch', { module: MOD })
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const repoData = payload.repository as
    | { name: string; owner: { login: string }; default_branch?: string }
    | undefined
  if (!repoData) return NextResponse.json({ ok: true })

  const owner = repoData.owner.login
  const repoName = repoData.name

  const dbRepo = await getRepoByOwnerAndName(owner, repoName)
  if (!dbRepo) {
    logger.debug('github webhook — repo not configured, skipping', { module: MOD, owner, repo: repoName })
    return NextResponse.json({ ok: true })
  }

  const actualOrgId = dbRepo.org_id

  // ── Push event → KB sync ──────────────────────────────────────────────────
  if (event === 'push') {
    const ref = typeof payload.ref === 'string' ? payload.ref : ''
    const defaultBranch = repoData.default_branch ?? 'main'
    // Default branch only — a push to any feature branch, tag, or PR ref used
    // to trigger a full repo re-embed. Ack anything else without work.
    if (dbRepo.kb_enabled === 1 && ref === `refs/heads/${defaultBranch}`) {
      try {
        // Enqueue and return fast. The old inline syncRepoToKB blew GitHub's
        // ~10s delivery deadline, so GitHub retried and two full
        // delete-and-recreate syncs raced; the queue's one-active debounce
        // collapses a retry (or a burst of pushes) to a single job, and the
        // cooldown spaces runs apart so serial pushes don't re-embed the repo
        // continuously.
        const job = await enqueueKbSyncJob({
          orgId: actualOrgId,
          kind: 'github_repo',
          repoId: dbRepo.id,
          cooldownMs: PUSH_SYNC_COOLDOWN_MS,
          rerunIfRunning: true,
        })
        logger.info('github push kb sync queued', { module: MOD, owner, repo: repoName, jobId: job.id, queued: job.created })
      } catch (err) {
        logger.error('failed to queue github push kb sync', { module: MOD, error: err })
      }
    }
    return NextResponse.json({ ok: true })
  }

  const action = payload.action as string | undefined

  // ── Discussion answered/unanswered → KB sync ────────────────────────────
  // Independent of ticket ingestion: a discussion can be a KB source even if
  // `monitored_events` excludes discussions from ticket creation.
  if (event === 'discussion' && (action === 'answered' || action === 'unanswered') && dbRepo.kb_enabled === 1) {
    const discussion = payload.discussion as { number: number }
    try {
      await syncSingleDiscussionToKB(owner, repoName, actualOrgId, discussion.number)
      logger.info('github discussion kb sync', { module: MOD, owner, repo: repoName, number: discussion.number, action })
    } catch (err) {
      logger.error('github discussion kb sync failed', { module: MOD, error: err })
    }
    return NextResponse.json({ ok: true })
  }

  // ── Ticket events ─────────────────────────────────────────────────────────
  const monitored = dbRepo.monitored_events

  if (event === 'issues' && (action === 'opened' || action === 'reopened')) {
    if (monitored !== 'issues' && monitored !== 'both') return NextResponse.json({ ok: true })
    const issue = payload.issue as { number: number; title: string; body: string | null; author_association?: string; user: { login: string; id: number; type?: string } }
    if (issue.user.type === 'Bot') return NextResponse.json({ ok: true })
    if (isMaintainerAuthored(issue.author_association)) return NextResponse.json({ ok: true })
    await handleTicket({
      messageId: `github-issue-${owner}-${repoName}-${issue.number}`,
      content: `${issue.title}\n\n${issue.body ?? ''}`.trim(),
      authorId: String(issue.user.id),
      authorName: issue.user.login,
      channelId: `${owner}/${repoName}`,
      orgId: actualOrgId,
      replyFn: async (text) => {
        const octokit = await getInstallationOctokitById(dbRepo.installation_id)
        await octokit.rest.issues.createComment({ owner, repo: repoName, issue_number: issue.number, body: text })
      },
    })
  } else if (event === 'issue_comment' && action === 'created') {
    if (monitored !== 'issues' && monitored !== 'both') return NextResponse.json({ ok: true })
    const issue = payload.issue as { number: number; state: string }
    if (issue.state !== 'open') return NextResponse.json({ ok: true })
    const comment = payload.comment as { id: number; body: string; author_association?: string; user: { login: string; id: number; type?: string } }
    if (comment.user.type === 'Bot') return NextResponse.json({ ok: true })
    const issueThreadId = githubThreadId(owner, repoName, 'issue', issue.number)
    const issueCommentId = `github-issue-comment-${owner}-${repoName}-${comment.id}`
    if (isMaintainerAuthored(comment.author_association)) {
      // Never a support request, but part of the conversation staff read.
      await recordThreadContextMessage(
        { messageId: issueCommentId, content: comment.body, authorName: comment.user.login, threadId: issueThreadId },
        actualOrgId
      )
      return NextResponse.json({ ok: true })
    }
    await handleTicket({
      messageId: issueCommentId,
      threadId: issueThreadId,
      content: comment.body,
      authorId: String(comment.user.id),
      authorName: comment.user.login,
      channelId: `${owner}/${repoName}`,
      orgId: actualOrgId,
      replyFn: async (text) => {
        const octokit = await getInstallationOctokitById(dbRepo.installation_id)
        await octokit.rest.issues.createComment({ owner, repo: repoName, issue_number: issue.number, body: text })
      },
    })
  } else if (event === 'discussion' && action === 'created') {
    if (monitored !== 'discussions' && monitored !== 'both') return NextResponse.json({ ok: true })
    const discussion = payload.discussion as { number: number; title: string; body: string | null; author_association?: string; user: { login: string; id: number; type?: string } }
    if (discussion.user.type === 'Bot') return NextResponse.json({ ok: true })
    if (isMaintainerAuthored(discussion.author_association)) return NextResponse.json({ ok: true })
    await handleTicket({
      messageId: `github-discussion-${owner}-${repoName}-${discussion.number}`,
      content: `${discussion.title}\n\n${discussion.body ?? ''}`.trim(),
      authorId: String(discussion.user.id),
      authorName: discussion.user.login,
      channelId: `${owner}/${repoName}`,
      orgId: actualOrgId,
      replyFn: null, // Discussion comment replies require GraphQL — skip auto-reply for now
    })
  } else if (event === 'discussion_comment' && action === 'created') {
    if (monitored !== 'discussions' && monitored !== 'both') return NextResponse.json({ ok: true })
    const discussion = payload.discussion as { number: number }
    const comment = payload.comment as { id: number; body: string; author_association?: string; user: { login: string; id: number; type?: string } }
    if (comment.user.type === 'Bot') return NextResponse.json({ ok: true })
    const discussionThreadId = githubThreadId(owner, repoName, 'discussion', discussion.number)
    const discussionCommentId = `github-discussion-comment-${owner}-${repoName}-${comment.id}`
    if (isMaintainerAuthored(comment.author_association)) {
      await recordThreadContextMessage(
        { messageId: discussionCommentId, content: comment.body, authorName: comment.user.login, threadId: discussionThreadId },
        actualOrgId
      )
      return NextResponse.json({ ok: true })
    }
    await handleTicket({
      messageId: discussionCommentId,
      threadId: discussionThreadId,
      content: comment.body,
      authorId: String(comment.user.id),
      authorName: comment.user.login,
      channelId: `${owner}/${repoName}`,
      orgId: actualOrgId,
      replyFn: null,
    })
  }

  return NextResponse.json({ ok: true })
}

async function handleTicket({
  messageId,
  threadId,
  content,
  authorId,
  authorName,
  channelId,
  orgId,
  replyFn,
}: {
  messageId: string
  // Set for a comment: the issue or discussion it sits under, which is also
  // the message id that issue's or discussion's own ticket was created under.
  threadId?: string
  content: string
  authorId: string
  authorName: string
  channelId: string
  orgId: number
  replyFn: ((text: string) => Promise<void>) | null
}) {
  try {
    // A short comment ("thanks, that fixed it") is worth keeping when it
    // continues a conversation we already track, and noise when it would
    // open a new ticket on its own.
    if (!content.trim()) return
    if (content.trim().length < 10 && !(threadId && (await getTicketByThreadId(threadId, orgId)))) return

    if (await isIngestRateLimited(orgId)) {
      logger.warn('github ticket ingest rate limited', { module: MOD, orgId })
      return
    }

    const result = await processCommunityMessage({
      messageId,
      threadId,
      content,
      authorId,
      authorName,
      channelId,
      platform: 'github',
    }, orgId)

    // Post AI draft back to GitHub if confidence is high enough
    // An appended comment continues a ticket we already answered; the AI
    // draft is not re-posted into a live conversation.
    if (replyFn && result && !result.duplicate && !result.appended) {
      const { getDb } = await import('@/lib/db/drizzle')
      const { tickets } = await import('@/lib/db/schema')
      const { eq } = await import('drizzle-orm')
      const [ticket] = await getDb()
        .select({ aiDraft: tickets.aiDraft, aiDraftStatus: tickets.aiDraftStatus, severityScore: tickets.severityScore })
        .from(tickets)
        .where(eq(tickets.id, result.ticket_id))
        .limit(1)

      if (ticket?.aiDraft && ticket.aiDraftStatus === 'posted') {
        await replyFn(ticket.aiDraft).catch((err) =>
          logger.warn('github reply failed', { module: MOD, error: err })
        )
      }
    }
  } catch (err) {
    logger.error('github ticket processing failed', { module: MOD, messageId, error: err })
  }
}
