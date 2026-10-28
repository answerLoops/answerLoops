import { createHash } from 'node:crypto'

/**
 * A stable fingerprint of an article's question and answer, used as its
 * revision identity. History records this instead of a copy of the text, so
 * two moments can be compared ("has this changed since?") without keeping the
 * content itself.
 *
 * Line endings and runs of whitespace are normalized first, so a reflow or a
 * trailing newline does not count as a change, while any change to the words
 * does. The question and answer are hashed as separate fields, so moving text
 * from one to the other changes the hash.
 */
export function contentHash(question: string, answer: string): string {
  return createHash('sha256')
    .update(JSON.stringify([normalizeForHash(question), normalizeForHash(answer)]))
    .digest('hex')
}

/** The text as the fingerprint sees it: one line ending style, runs of whitespace collapsed, trimmed. */
export function normalizeForHash(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
}
