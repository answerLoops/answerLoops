import { scrubPersonalData } from '@/lib/kb/review-capture'

export const MAX_FLAG_QUESTION_CHARS = 500
export const MAX_FLAG_ANSWER_CHARS = 4000
export const MAX_FLAG_NOTE_CHARS = 1000

// C0/C1 control characters and the Unicode line and paragraph separators,
// checked by code point so no control character appears in a pattern. Newlines
// and tabs are kept or flattened by the caller.
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
}

/**
 * Text a visitor's widget sent with a flag, made safe to store and show: control
 * characters removed, personal data (emails, phone numbers, long digit runs)
 * replaced, trimmed and capped. The widget is public, so nothing here is trusted
 * as written. With `keepNewlines` false the result is a single plain line.
 */
export function cleanFlagText(raw: unknown, maxChars: number, keepNewlines: boolean): string {
  if (typeof raw !== 'string') return ''
  let out = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0x0a && keepNewlines) out += '\n'
    else out += isControl(code) ? ' ' : ch
  }
  out = keepNewlines ? out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : out.replace(/\s+/g, ' ')
  return scrubPersonalData(out).trim().slice(0, maxChars)
}
