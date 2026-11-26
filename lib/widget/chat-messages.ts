/**
 * Checks the conversation the website widget sends with each message.
 *
 * The widget's chat client sends the whole conversation every time, in the
 * AG-UI message format: the visitor's messages, the assistant's replies, and
 * the results of the tools the assistant called. The route only reads the
 * visitor's messages (the latest one is the question, and the one before it
 * can help look up a short follow-up, see lib/widget/lookup-text.ts). The
 * model gets its history from server-side memory, not from this array.
 *
 * Each role is checked for the shape AG-UI gives it. An assistant reply that
 * only shows a card (show_contact_options, show_steps, ...) is a tool call
 * with no text, and a tool result carries text, sometimes knowledge-base
 * articles longer than a visitor message may be. Requiring text on every
 * message, capped at the visitor-message length, refused the visitor's next
 * message after any card or knowledge-base search.
 *
 * Assistant replies and tool results are not held to the per-message length
 * cap, since they are never read; every other message still is. The whole
 * request stays bounded by the route's body size cap and message count.
 */

/** A message as the route reads it once checkWidgetMessages has passed. */
export interface WidgetChatMessage {
  role?: string
  content?: unknown
  toolCalls?: unknown
  toolCallId?: unknown
}

export type WidgetMessagesCheck = { ok: true } | { ok: false; error: 'Malformed messages' | 'Message too long' }

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'

function wellFormed(message: unknown): boolean {
  if (!isObject(message) || typeof message.role !== 'string') return false
  switch (message.role) {
    case 'assistant':
      // Text, a tool call, or both. A reply that only shows a card has no text.
      return (
        (message.content === undefined || typeof message.content === 'string') &&
        (message.toolCalls === undefined || Array.isArray(message.toolCalls))
      )
    case 'tool':
      return typeof message.content === 'string' && typeof message.toolCallId === 'string'
    default:
      return typeof message.content === 'string'
  }
}

const UNCAPPED_ROLES = new Set(['assistant', 'tool'])

export function checkWidgetMessages(messages: readonly unknown[], maxMessageChars: number): WidgetMessagesCheck {
  if (!messages.every(wellFormed)) return { ok: false, error: 'Malformed messages' }
  const tooLong = (messages as WidgetChatMessage[]).some(
    (m) => !UNCAPPED_ROLES.has(m.role as string) && (m.content as string).length > maxMessageChars
  )
  if (tooLong) return { ok: false, error: 'Message too long' }
  return { ok: true }
}
