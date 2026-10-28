import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTicketByOrgTicketNumber, getTicketReplies, getTicketEvents } from '@/lib/db/queries/tickets'
import { StatusBadge, PriorityBadge, CategoryBadge, AIDraftBadge } from '@/components/ui/badge'
import { TicketStatusForm } from '@/components/tickets/ticket-status-form'
import { DeleteTicketButton } from '@/components/tickets/delete-ticket-button'
import { auth } from '@/auth'
import { getOrgMembers } from '@/lib/db/queries/members'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { ReplyForm } from '@/components/tickets/reply-form'
import { AIDraftPanel } from '@/components/tickets/ai-draft-panel'
import { DraftSkippedNotice } from '@/components/tickets/draft-skipped-notice'
import { getSLAStatus } from '@/lib/sla/engine'
import { getRelatedTickets } from '@/lib/db/queries/embeddings'
import { DUPLICATE_THRESHOLD } from '@/lib/ai/related'
import { getAssessment } from '@/lib/db/queries/assessments'
import { getFeedbackSummary } from '@/lib/db/queries/feedback'
import { FeedbackButtons } from '@/components/tickets/feedback-buttons'
import { getArticleBySourceTicket } from '@/lib/db/queries/kb'
import { PromoteKBButton } from '@/components/tickets/promote-kb-button'
import { AnswerSourcesPanel } from '@/components/dashboard/answer-sources'
import { getAnswerSourcesForTicket } from '@/lib/db/queries/kb-answers'
import { LocalDate } from '@/components/ui/local-date'
import { telegramMessageIdFromSource } from '@/lib/telegram/message-id'
import { getIntegration, parseGuildChannelMap } from '@/lib/db/queries/integrations'
import { getEmailMessagesForTicket } from '@/lib/db/queries/email-messages'
import { TicketContent } from '@/components/tickets/ticket-content'
import { TicketThread } from '@/components/tickets/ticket-thread'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

// Always reflect the latest ticket state (drafts, assessments, feedback).
export const dynamic = 'force-dynamic'

export default async function TicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const ticket = await getTicketByOrgTicketNumber(Number(id), orgId)
  if (!ticket) notFound()

  const [replies, events, related, assessment, feedback, kbArticle, members, discordIntegration, emailMessages, sourceIntegration] =
    await Promise.all([
      getTicketReplies(ticket.id),
      getTicketEvents(ticket.id),
      getRelatedTickets(ticket.id, orgId),
      getAssessment(ticket.id),
      getFeedbackSummary(ticket.id),
      getArticleBySourceTicket(ticket.id, orgId),
      getOrgMembers(orgId),
      getIntegration(orgId, 'discord'),
      ticket.source_platform === 'email' ? getEmailMessagesForTicket(ticket.id, orgId) : Promise.resolve([]),
      ticket.source_platform && ticket.source_platform !== 'github' && ticket.source_platform !== 'mcp'
        ? getIntegration(orgId, ticket.source_platform)
        : Promise.resolve(null),
    ])

  // The confidence assessment card shows "needs human review" whether that's
  // because the answer was genuinely low-confidence or because it would have
  // cleared the bar but the org has Automatic Deflections switched off for
  // this channel — those read identically to staff without this flag, but
  // only the second case means "nothing was sent, respond manually."
  const deflectionsOffForSource =
    !!sourceIntegration && sourceIntegration.auto_deflect_enabled !== 1

  const failedDelivery = emailMessages.find(
    (m) => m.direction === 'out' && (m.status === 'bounced' || m.status === 'delivery_failed')
  )

  const sla = getSLAStatus(ticket)
  const duplicateCount = related.filter((r) => r.score >= DUPLICATE_THRESHOLD).length
  const resolved = ticket.status === 'resolved' || ticket.status === 'closed'
  const hasAnswer = Boolean(ticket.resolution_notes || ticket.ai_draft)

  const currentUserId = session?.user?.id ? Number(session.user.id) : null
  const isOwner = members.find((m) => m.user_id === currentUserId)?.role === 'owner'
  const currentRole = members.find((m) => m.user_id === currentUserId)?.role
  const canPromote = currentRole === 'owner' || currentRole === 'admin'
  // The articles supplied to this draft: owners and admins only, and only read
  // for them, so a plain member's request never touches the answer records.
  const answerSources = canPromote ? await getAnswerSourcesForTicket(ticket.id, orgId) : null

  // Resolve guild ID: prefer per-ticket value (new tickets), fall back to
  // the channel→guild map auto-saved by the bot on startup (old tickets).
  const guildChannelMap = discordIntegration ? parseGuildChannelMap(discordIntegration) : {}
  const resolvedGuildId =
    ticket.discord_guild_id ??
    (ticket.source_channel_id ? guildChannelMap[ticket.source_channel_id] ?? null : null)

  // For forum/thread messages the message lives inside a thread (post), not
  // the parent forum channel. Discord deep links need the thread ID.
  const resolvedChannelId = ticket.source_thread_id ?? ticket.source_channel_id

  const { text: contentText, attachments: contentAttachments } = parseAttachmentLines(ticket.content)
  const titleFallback = contentText.slice(0, 120) || `Shared ${contentAttachments.length} attachment${contentAttachments.length === 1 ? '' : 's'}`

  return (
    <div className="dashboard-page max-w-6xl space-y-6">
      {/* Back navigation */}
      <Link href="/tickets" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:text-blue-800">
        ← Back to tickets
      </Link>

      {/* Header */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-gray-400">#{ticket.org_ticket_number}</span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.category && <CategoryBadge category={ticket.category} />}
            <AIDraftBadge status={ticket.ai_draft_status} />
            {sla.anyBreached && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">SLA breached</span>
            )}
            {duplicateCount > 0 && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                Asked {duplicateCount + 1}×
              </span>
            )}
            {failedDelivery && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                {failedDelivery.status === 'bounced' ? 'Reply bounced' : 'Delivery failed'}
              </span>
            )}
            {assessment && (
              assessment.auto_deflected === 1 ? (
                <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                  Auto-answered {Math.round(assessment.confidence * 100)}%
                </span>
              ) : (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  Needs review {Math.round(assessment.confidence * 100)}%
                </span>
              )
            )}
          </div>
          <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-slate-950">
            {ticket.ai_summary ?? titleFallback}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            From {ticket.source_author_name ?? 'Unknown'} ·{' '}
            <LocalDate iso={ticket.created_at} time />
          </p>
          {ticket.discord_deleted_at ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-gray-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.054A19.9 19.9 0 0 0 5.9 20.89a.077.077 0 0 0 .084-.026c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028A19.839 19.839 0 0 0 23.9 18.11a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Source deleted from Discord
            </span>
          ) : ticket.source_platform === 'telegram' && ticket.source_channel_id && ticket.source_message_id ? (
            <a
              href={`https://t.me/c/${ticket.source_channel_id.replace('-100', '')}/${telegramMessageIdFromSource(ticket.source_message_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-800 hover:underline"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              View in Telegram ↗
            </a>
          ) : ticket.source_platform === 'discourse' && ticket.source_url ? (
            <a
              href={ticket.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-800 hover:underline"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.021.5 3.926 1.383 5.6L0 24l6.578-1.353A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 3.6a8.4 8.4 0 0 1 7.29 12.57l.71 4.02-4.12-.94A8.4 8.4 0 1 1 12 3.6z"/>
              </svg>
              View in Discourse ↗
            </a>
          ) : ticket.source_platform === 'circle' && ticket.source_url ? (
            <a
              href={ticket.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 hover:underline"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
              </svg>
              View in Circle ↗
            </a>
          ) : ticket.source_platform === 'slack' && ticket.source_channel_id && ticket.source_url ? (
            <a
              href={ticket.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 hover:underline"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
              </svg>
              View in Slack ↗
            </a>
          ) : ticket.source_platform === 'slack' && ticket.source_channel_id ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-purple-600">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
              </svg>
              Slack · #{ticket.source_channel_id}
            </span>
          ) : ticket.source_platform === 'github' && ticket.source_channel_id && ticket.source_message_id ? (
            (() => {
              const msgId = ticket.source_message_id
              const isDiscussion = msgId.startsWith('github-discussion-') && !msgId.startsWith('github-discussion-comment-')
              const isIssue = msgId.startsWith('github-issue-') && !msgId.startsWith('github-issue-comment-')
              if (!isIssue && !isDiscussion) return null
              const num = msgId.split('-').pop()
              const [owner, repo] = ticket.source_channel_id.split('/')
              const path = isDiscussion ? 'discussions' : 'issues'
              return (
                <a
                  href={`https://github.com/${owner}/${repo}/${path}/${num}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 hover:underline"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                  </svg>
                  View on GitHub ↗
                </a>
              )
            })()
          ) : ticket.source_platform === 'google_chat' && ticket.source_channel_id ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-blue-600">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.657 1.438 5.163L2 22l4.837-1.438A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
              </svg>
              Google Chat
            </span>
          ) : ticket.source_platform === 'email' && ticket.source_author_id ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-amber-600">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email from {ticket.source_author_id}
            </span>
          ) : resolvedGuildId && resolvedChannelId && ticket.source_message_id ? (
            <a
              href={`https://discord.com/channels/${resolvedGuildId}/${resolvedChannelId}/${ticket.source_message_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800 hover:underline"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.054A19.9 19.9 0 0 0 5.9 20.89a.077.077 0 0 0 .084-.026c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028A19.839 19.839 0 0 0 23.9 18.11a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              View in Discord ↗
            </a>
          ) : null}
        </div>
        {isOwner && <DeleteTicketButton ticketId={ticket.id} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: main content */}
        <div className="lg:col-span-2 space-y-5">
          {/* Original message */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Original Message</h2>
            <TicketContent content={ticket.content} />
          </div>

          {/* AI Draft */}
          {ticket.ai_draft && ticket.ai_draft_status !== 'pending' && (
            <AIDraftPanel
              ticketId={ticket.id}
              draft={ticket.ai_draft}
              status={ticket.ai_draft_status}
              sourcePlatform={ticket.source_platform ?? 'discord'}
            />
          )}
          {answerSources && <AnswerSourcesPanel data={answerSources} />}
          {ticket.ai_draft_status === 'pending' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
              AI agent is generating an answer from GitHub source code…
            </div>
          )}
          {ticket.ai_draft_status === 'needs_human' && !ticket.ai_draft && (
            <DraftSkippedNotice reason={ticket.ai_draft_skip_reason} />
          )}

          {/* Confidence assessment */}
          {assessment && (
            <div className={`rounded-lg border px-4 py-3 ${assessment.auto_deflected === 1 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  AI Confidence
                </span>
                <span className={`text-xs font-semibold ${assessment.auto_deflected === 1 ? 'text-green-700' : 'text-amber-700'}`}>
                  {Math.round(assessment.confidence * 100)}% · {assessment.auto_deflected === 1 ? 'auto-answered' : 'needs human review'}
                </span>
              </div>
              {assessment.auto_deflected !== 1 && deflectionsOffForSource && (
                <p className="mb-1.5 text-xs font-medium text-amber-800">
                  {ticket.source_platform === 'circle'
                    ? 'Circle is ingest-only — copy the draft below and paste it into Circle by hand.'
                    : `Automatic Deflections is off for ${ticket.source_platform} — nothing was sent to the customer. Approve and send the draft below, or reply manually.`}
                </p>
              )}
              {assessment.reasoning && (
                <p className="text-xs text-gray-600">{assessment.reasoning}</p>
              )}
              <div className="mt-3 border-t border-gray-200/70 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Was this answer good?</p>
                <FeedbackButtons ticketId={ticket.id} summary={feedback} />
              </div>
            </div>
          )}

          {/* Conversation: every message after the opening one, any channel */}
          <TicketThread replies={replies} />

          {/* Reply form */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Reply</h2>
            <ReplyForm ticketId={ticket.id} sourcePlatform={ticket.source_platform ?? 'discord'} />
          </div>
        </div>

        {/* Right: metadata + status */}
        <div className="space-y-4">
          {/* Ticket info */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</h2>
            <dl className="space-y-2 text-sm">
              {ticket.severity_score !== null && (
                <div>
                  <dt className="text-xs text-gray-500">Severity</dt>
                  <dd className="font-medium">{(ticket.severity_score * 100).toFixed(0)}%</dd>
                </div>
              )}
              {ticket.sla_response_deadline && (
                <div>
                  <dt className="text-xs text-gray-500">Response deadline</dt>
                  <dd className={`font-medium text-xs ${sla.responseBreached ? 'text-red-600' : 'text-gray-700'}`}>
                    {new Date(ticket.sla_response_deadline).toLocaleString()}
                    {sla.responseBreached ? ' (breached)' : ticket.sla_response_met === 1 ? ' (met)' : ''}
                  </dd>
                </div>
              )}
              {ticket.sla_resolve_deadline && (
                <div>
                  <dt className="text-xs text-gray-500">Resolve deadline</dt>
                  <dd className={`font-medium text-xs ${sla.resolveBreached ? 'text-red-600' : 'text-gray-700'}`}>
                    {new Date(ticket.sla_resolve_deadline).toLocaleString()}
                    {sla.resolveBreached ? ' (breached)' : ticket.sla_resolve_met === 1 ? ' (met)' : ''}
                  </dd>
                </div>
              )}
              {ticket.source_author_name && (
                <div>
                  <dt className="text-xs text-gray-500">
                    {ticket.source_platform === 'github' ? 'GitHub user' :
                     ticket.source_platform === 'slack' ? 'Slack user' :
                     ticket.source_platform === 'telegram' ? 'Telegram user' :
                     ticket.source_platform === 'discourse' ? 'Discourse user' :
                     ticket.source_platform === 'circle' ? 'Circle member' :
                     ticket.source_platform === 'email' ? 'Email sender' :
                     ticket.source_platform === 'google_chat' ? 'Google Chat user' :
                     ticket.source_platform === 'mcp' ? 'Opened by' :
                     'Discord user'}
                  </dt>
                  <dd>{ticket.source_author_name}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Related questions */}
          {related.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Related Questions</h2>
              <ul className="space-y-2.5">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/tickets/${r.org_ticket_number}`} className="group block">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs text-gray-400">#{r.org_ticket_number}</span>
                        <StatusBadge status={r.status} />
                        <span className="text-xs text-gray-400 ml-auto">{(r.score * 100).toFixed(0)}% match</span>
                      </div>
                      <p className="text-sm text-gray-700 group-hover:text-brand-600 transition-colors line-clamp-2">
                        {r.summary}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Update status */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Update Status</h2>
            <TicketStatusForm ticketId={ticket.id} currentStatus={ticket.status} />
          </div>

          {/* Knowledge base */}
          {(resolved && hasAnswer) || kbArticle ? (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Knowledge Base</h2>
              <PromoteKBButton ticketId={ticket.id} articleId={kbArticle?.id} canPromote={canPromote} />
              {!kbArticle && (
                <p className="mt-2 text-xs text-gray-400">Publish this answer as a searchable KB article.</p>
              )}
            </div>
          ) : null}

          {/* Event log */}
          {events.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity</h2>
              <ul className="space-y-2">
                {events.map((event) => (
                  <li key={event.id} className="text-xs text-gray-600 flex gap-1.5">
                    <span className="text-gray-400 shrink-0"><LocalDate iso={event.created_at} /></span>
                    <span>
                      {event.actor && <strong>{event.actor}</strong>}{' '}
                      {event.event_type.replace(/_/g, ' ')}
                      {event.old_value && event.new_value && ` (${event.old_value} → ${event.new_value})`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
