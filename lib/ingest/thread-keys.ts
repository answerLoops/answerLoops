import { telegramSourceMessageId } from '@/lib/telegram/message-id'
import type { Platform } from '@/lib/ingest/pipeline'

/**
 * How each channel identifies "the conversation this message belongs to".
 *
 * processCommunityMessage appends a message to an existing ticket when it is
 * given a thread id that matches the ticket's own message id, its thread id,
 * or the id of a message already stored in its thread (getTicketByThreadId).
 * So the contract every channel follows is: the thread id is the same for
 * every message in one conversation, and for the message that opened it, it
 * equals that message's own id. This table is typed over every Platform, so
 * adding a channel fails to compile until its threading is stated here, and
 * the table-driven test in tests/unit/channel-threading.test.ts then runs the
 * same create / append / separate-thread scenario against it.
 */
export type ThreadSource =
  /** The channel names the thread on every message (Slack thread_ts, Discourse topic, ...). */
  | 'channel-thread-id'
  /** The thread is the message a reply points at, so replies chain (Telegram). */
  | 'reply-to-message'
  /** The thread is derived from the issue or discussion the comment sits under (GitHub). */
  | 'parent-record'
  /** Matched by the channel's own header chain before the pipeline runs (email). */
  | 'message-header-chain'
  /** Each call is a standalone question with nothing to continue (API and MCP). */
  | 'standalone'

export interface ChannelThreading {
  source: ThreadSource
  /** Where the code that supplies the thread id lives. */
  entryPoint: string
}

export const CHANNEL_THREADING: Record<Platform, ChannelThreading> = {
  discord: { source: 'channel-thread-id', entryPoint: 'app/api/ingest/route.ts' },
  slack: { source: 'channel-thread-id', entryPoint: 'app/api/slack/events/route.ts' },
  google_chat: { source: 'channel-thread-id', entryPoint: 'app/api/google-chat/events/route.ts' },
  discourse: { source: 'channel-thread-id', entryPoint: 'app/api/discourse/webhook/route.ts' },
  circle: { source: 'channel-thread-id', entryPoint: 'app/api/circle/webhook/route.ts' },
  telegram: { source: 'reply-to-message', entryPoint: 'app/api/telegram/webhook/route.ts' },
  github: { source: 'parent-record', entryPoint: 'app/api/github/webhook/route.ts' },
  email: { source: 'message-header-chain', entryPoint: 'app/api/email/ingest/route.ts' },
  mcp: { source: 'standalone', entryPoint: 'lib/agent/core.ts' },
}

/**
 * The thread id for a GitHub comment: the message id the issue's or
 * discussion's own ticket was created under, so every comment lands on it.
 */
export function githubThreadId(owner: string, repo: string, kind: 'issue' | 'discussion', number: number): string {
  return `github-${kind}-${owner}-${repo}-${number}`
}

/**
 * The thread id for a Telegram message that replies to another: the replied-to
 * message, whether that is the ticket's opening message or a reply already in
 * its thread. Null for a message that is not a reply.
 */
export function telegramThreadId(chatId: string | number, replyToMessageId: number | undefined): string | null {
  return replyToMessageId === undefined ? null : telegramSourceMessageId(chatId, replyToMessageId)
}
