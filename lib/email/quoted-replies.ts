/**
 * Removes the quoted part of an email reply so a ticket shows only what the
 * sender wrote:
 *
 * - lines starting with `>` are dropped, and
 * - when the text ends with "wrote:" (plus any trailing whitespace), everything
 *   from the first line starting with "On " onwards is dropped, which is the
 *   "On <date>, <name> wrote:" header most mail clients put above a quote.
 *
 * Work is proportional to the length of the text.
 */
export function stripQuotedReplies(text: string): string {
  const withoutQuoteLines = text
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
  return stripTrailingWroteHeader(withoutQuoteLines).trim()
}

const WROTE = 'wrote:'
const HEADER_START = '\nOn '

function stripTrailingWroteHeader(text: string): string {
  let end = text.length
  while (end > 0 && /\s/.test(text[end - 1])) end--
  const wroteAt = end - WROTE.length
  if (wroteAt < 0 || text.slice(wroteAt, end) !== WROTE) return text

  const headerAt = text.indexOf(HEADER_START)
  // At least one character must sit between "On " and "wrote:".
  if (headerAt === -1 || wroteAt < headerAt + HEADER_START.length + 1) return text
  return text.slice(0, headerAt)
}
