import crypto from 'crypto'

/**
 * Proof that a question attached to a widget lead is one this server actually
 * recorded for a failed turn, rather than free text a caller made up.
 *
 * app/api/widget/lead-signal/route.ts mints one when it reports a failed turn;
 * the widget hands it back unchanged with the visitor's email, and
 * app/api/widget/lead/route.ts verifies it and saves the question inside it.
 * The lead route never accepts question text from the request body, so what
 * the team reads on the Leads page is always something the visitor really sent
 * to the widget chat.
 *
 * Stateless (HMAC over the payload, derived from AUTH_SECRET with its own
 * domain-separation label, same approach as lib/widget/render-token.ts), so it
 * verifies on any app instance — unlike the in-memory signal stash it is
 * minted from.
 */
const QUESTION_TOKEN_TTL_MS = 30 * 60_000
const MAX_QUESTION_CHARS = 500

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — cannot mint or verify widget lead question tokens.')
  }
  return crypto.createHmac('sha256', secret).update('widget-lead-question-v1').digest()
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', deriveKey()).update(payload).digest('base64url')
}

/**
 * Control characters and runs of whitespace flattened to single spaces, then
 * trimmed and capped. What reaches the Leads page and its CSV export is a
 * single plain line.
 */
// C0/C1 control characters plus the Unicode line and paragraph separators.
// Checked by code point rather than a regex so no control character has to
// appear in a pattern.
function isControlOrSeparator(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
}

export function sanitizeLeadQuestion(raw: string): string {
  let flat = ''
  for (const ch of raw) flat += isControlOrSeparator(ch.codePointAt(0) ?? 0) ? ' ' : ch
  return flat
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUESTION_CHARS)
}

/** Returns null when there is nothing worth attaching. */
export function mintLeadQuestionToken(widgetToken: string, question: string, now = Date.now()): string | null {
  const clean = sanitizeLeadQuestion(question)
  if (!clean) return null
  const payload = Buffer.from(JSON.stringify({ w: widgetToken, q: clean, e: now + QUESTION_TOKEN_TTL_MS })).toString(
    'base64url'
  )
  return `${payload}.${sign(payload)}`
}

/** The question inside a valid, unexpired token minted for this widget, else null. */
export function verifyLeadQuestionToken(token: unknown, widgetToken: string, now = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 4096) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const given = token.slice(dot + 1)
  const expected = sign(payload)
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  if (!crypto.timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      w?: unknown
      q?: unknown
      e?: unknown
    }
    if (parsed.w !== widgetToken) return null
    if (typeof parsed.e !== 'number' || parsed.e < now) return null
    if (typeof parsed.q !== 'string') return null
    // Re-sanitised on the way out so the saved value never depends on what an
    // older token format allowed through.
    return sanitizeLeadQuestion(parsed.q) || null
  } catch {
    return null
  }
}
