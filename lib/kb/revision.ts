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
  const normalize = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(JSON.stringify([normalize(question), normalize(answer)])).digest('hex')
}
