/**
 * The text the website widget searches the knowledge base with.
 *
 * Usually that's the visitor's latest message. A short follow-up ("and for
 * teams?", "rate limits?") doesn't say what it's about on its own, so it is
 * searched together with the visitor's previous question. Only the lookup
 * changes: the assistant still answers the visitor's actual message, from
 * published articles only, and the match bar is the same.
 */

/** A latest message of this many words or fewer counts as a follow-up. */
export const FOLLOW_UP_MAX_WORDS = 5

/** The previous question is shortened to this, so it can't crowd out the follow-up. */
export const PREVIOUS_QUESTION_MAX_CHARS = 300

interface Message {
  role?: string
  content?: unknown
}

const visitorText = (m: Message): string => (m.role === 'user' && typeof m.content === 'string' ? m.content.trim() : '')

export function widgetLookupText(messages: readonly Message[]): string {
  const questions = messages.map(visitorText).filter(Boolean)
  const latest = questions.at(-1) ?? ''
  const previous = questions.at(-2)
  if (!previous || latest.split(/\s+/).length > FOLLOW_UP_MAX_WORDS) return latest
  return `${previous.slice(0, PREVIOUS_QUESTION_MAX_CHARS)}\n${latest}`
}
