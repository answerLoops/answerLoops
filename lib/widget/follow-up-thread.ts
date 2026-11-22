import type { Message } from '@ag-ui/client'
import { GENUI_TOOL_NAMES } from '@/lib/widget/genui'

/**
 * Which follow-up suggestions on screen are still live.
 *
 * Suggestions are only useful right after the answer they follow. They stop
 * being live once the visitor replies, so only the newest reply's suggestions
 * can ever be pressed. Pure and separate from the panel so the rule is tested
 * directly.
 */

type ToolCallLike = NonNullable<Extract<Message, { role: 'assistant' }>['toolCalls']>[number]

const isFollowUpCall = (call: ToolCallLike) => call.function.name === GENUI_TOOL_NAMES.followUps

/** The ids of every follow-up tool call in a thread (the restored one, say). */
export function followUpCallIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of (message.toolCalls ?? []) as ToolCallLike[]) {
      if (isFollowUpCall(call)) ids.add(call.id)
    }
  }
  return ids
}

/**
 * The follow-up tool call whose suggestions may be pressed now: the newest one
 * after the visitor's last message, and only once its result has arrived. A
 * visitor message anywhere after it means it is no longer live. Null when there
 * is none.
 */
export function latestFollowUpCallId(messages: readonly Message[]): string | null {
  const answered = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool' && typeof message.toolCallId === 'string') answered.add(message.toolCallId)
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'user') return null
    if (message.role !== 'assistant') continue
    const allCalls = (message.toolCalls ?? []) as ToolCallLike[]
    const calls = allCalls.filter(isFollowUpCall)
    // One card per reply: a reply that already carries another card gets no
    // suggestions, whatever the assistant asked for.
    if (calls.length > 0 && allCalls.some((call) => !isFollowUpCall(call))) return null
    for (let j = calls.length - 1; j >= 0; j--) {
      if (answered.has(calls[j].id)) return calls[j].id
    }
  }
  return null
}
