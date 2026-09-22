import { logger } from '@/lib/logger'
import { sendToChannel } from '@/lib/discord/send'
import { sendToSlackChannel } from '@/lib/slack/send'
import { sendToTelegramChat } from '@/lib/telegram/send'
import { sendEmailReply } from '@/lib/email/reply'
import { sendToGoogleChatSpace } from '@/lib/google-chat/send'
import { postToDiscourseTopic } from '@/lib/discourse/send'

const MOD = 'channels/post-reply'

export type Platform = 'discord' | 'slack' | 'telegram' | 'email' | 'github' | 'mcp' | 'google_chat' | 'discourse' | 'circle'

// Single per-platform send dispatch, shared by every caller that delivers a
// reply to a customer channel: the auto-deflect path (lib/ai/agent.ts), the
// staff manual-reply box, and the Approve/Edit draft actions
// (lib/actions/tickets.ts). Previously each of those three call sites had
// its own hand-rolled (and differently incomplete) copy of this switch.
export async function postReply(
  channelId: string,
  content: string,
  orgId: number,
  platform: Platform,
  ticketId?: number,
  // Slack-only: the *real* channel id and (if this is a thread reply) the
  // thread's ts, kept separate from `channelId` above. `channelId` there is
  // "thread id if in a thread, else channel id" — correct for Discord,
  // which posts into a thread using the thread's own id as the channel
  // param, but wrong for Slack, which always needs the real channel id in
  // `channel` plus thread_ts as its own field. See lib/slack/send.ts.
  slackChannelId?: string,
  slackThreadTs?: string
): Promise<string | null> {
  if (platform === 'slack') return sendToSlackChannel(slackChannelId ?? channelId, content, orgId, slackThreadTs)
  if (platform === 'google_chat') {
    // channelId here is "thread id if in a thread, else space id" (the
    // Discord-style convention every caller already passes) — a Google Chat
    // thread resourceName is `spaces/X/threads/Y`, so the space name is
    // recoverable as its own prefix without a third parameter like Slack
    // needs for the same channel-vs-thread distinction.
    const isThread = channelId.includes('/threads/')
    const spaceName = isThread ? channelId.split('/threads/')[0] : channelId
    return sendToGoogleChatSpace(spaceName, content, isThread ? channelId : undefined)
  }
  if (platform === 'telegram') return sendToTelegramChat(channelId, content, orgId)
  // channelId here is the Discourse topic id — every caller passes
  // `threadId ?? channelId` and the ingest route sets threadId to the topic
  // id, so a reply is always a new post appended to that topic.
  if (platform === 'discourse') return postToDiscourseTopic(channelId, content, orgId)
  if (platform === 'email') return sendEmailReply(channelId, content, orgId, ticketId)
  // MCP-created tickets have no live channel to post into — the draft is
  // saved separately and surfaced via the ticket itself (get_tickets tool /
  // dashboard), not pushed anywhere.
  if (platform === 'mcp') return null
  // Circle is ingest-only (stage 1): its write API is unconfirmed, so the
  // AI draft is parked on the ticket for a human to copy into Circle by
  // hand. Nothing is transmitted.
  if (platform === 'circle') return null
  // GitHub has no channelId-shaped destination (it needs owner/repo/issue
  // number, not a channel id + optional thread) — callers must branch to
  // postReplyToGithub below instead of calling this function. Explicit
  // no-op rather than falling through to sendToChannel below, which is
  // Discord-specific and would either silently no-op (no Discord
  // integration configured) or 404 against Discord's API using an
  // "owner/repo" string as a channel id.
  if (platform === 'github') return null
  return sendToChannel(channelId, content, orgId)
}

// Google Chat's own client shows "[App] is not responding" to everyone in
// the thread whenever the app receives a message and sends nothing back at
// all — unlike Slack/Discord, where silence is just silence, this reads as
// a broken integration to the customer even when the ticket was created and
// triaged correctly behind the scenes. Confirmed against Google's docs:
// there's no documented way to acknowledge an event without this indicator
// appearing other than actually sending a message, and returning an empty
// `{}` (the documented no-op response) is exactly what triggers it.
//
// Every silent path in the ingest/agent pipeline (Automatic Deflections
// off, a thread reply that doesn't re-trigger the AI) calls this after
// deciding not to send real content, so Google Chat specifically still
// gets a neutral receipt. It carries zero information about the ticket —
// no AI draft text, no confidence score, nothing that could read as an
// unsupervised answer — it exists purely to satisfy Chat's UI. Every other
// platform no-ops here, since they don't have this quirk.
export async function sendKeepAlive(platform: Platform, channelId: string, orgId: number): Promise<void> {
  if (platform !== 'google_chat') return
  try {
    await postReply(channelId, '👍', orgId, platform)
  } catch (err) {
    logger.warn('Google Chat keep-alive receipt failed', { module: MOD, error: err })
  }
}

// GitHub's equivalent of postReply above — posts an issue comment instead
// of a channel message. Kept as a separate function rather than overloading
// postReply's channelId param a fifth way (it already does double duty as
// "thread-id-or-channel-id" for Discord/Slack/Google Chat).
export async function postReplyToGithub(
  ownerRepoChannelId: string, // ticket.source_channel_id, "owner/repo"
  sourceMessageId: string,    // ticket.source_message_id, e.g. "github-issue-42"
  body: string,
  orgId: number
): Promise<string | null> {
  const [owner, repo] = ownerRepoChannelId.split('/')
  const parts = sourceMessageId.split('-')
  const issueNumber = Number(parts[parts.length - 1])
  if (!owner || !repo || !issueNumber) return null

  try {
    const { getRepoByOwnerAndName } = await import('@/lib/db/queries/github')
    const { getInstallationOctokitById } = await import('@/lib/github/app')
    const repoRecord = await getRepoByOwnerAndName(owner, repo)
    if (!repoRecord || repoRecord.org_id !== orgId) return null
    const octokit = await getInstallationOctokitById(repoRecord.installation_id)
    const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body })
    return String(data.id)
  } catch (err) {
    logger.warn('failed to post to github', { module: MOD, error: err })
    return null
  }
}
