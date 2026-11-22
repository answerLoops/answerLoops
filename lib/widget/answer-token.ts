import crypto from 'crypto'

/**
 * Signed proof that a widget answer, or a flag made on one, is something this
 * server really produced for this widget, so the flag route never takes an
 * answer id or a flag id as a bare value from the request.
 *
 * Two kinds, with separate keys so one can never be passed off as the other:
 *  - an answer token: minted by app/api/widget/lead-signal/route.ts for a turn
 *    that produced an answer, handed back with a visitor's flag on that answer;
 *  - a flag token: minted by app/api/widget/flag/route.ts when a flag is made,
 *    handed back when the visitor adds a reason, note or email to that same flag.
 *
 * An answer token also carries the question and the reply this server saw for
 * that turn, so what a team member later reads on a flag is exactly what the
 * visitor asked and was told, never text a caller made up (the same rule the
 * lead route keeps for a lead's question). It is the visitor's own conversation
 * held by the visitor's own browser until they choose to flag it; nothing is
 * stored on the server for an answer nobody flags. Neither token carries identity.
 *
 * Stateless (HMAC over the payload, derived from AUTH_SECRET with its own
 * domain-separation label, same approach as lib/widget/lead-question-token.ts),
 * so it verifies on any app instance.
 */
const ANSWER_TOKEN_TTL_MS = 6 * 60 * 60_000
const FLAG_TOKEN_TTL_MS = 60 * 60_000

// An answer token holds the question and reply, so it is far larger than a flag
// token. The question and reply are capped well below this when it is minted.
const MAX_ANSWER_TOKEN_CHARS = 16 * 1024
const MAX_TOKEN_QUESTION_CHARS = 1000
const MAX_TOKEN_REPLY_CHARS = 6000

type Kind = 'answer' | 'flag'

const LABELS: Record<Kind, string> = {
  answer: 'widget-answer-ref-v1',
  flag: 'widget-answer-flag-v1',
}

function deriveKey(kind: Kind): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — cannot mint or verify widget answer tokens.')
  }
  return crypto.createHmac('sha256', secret).update(LABELS[kind]).digest()
}

function sign(kind: Kind, payload: string): string {
  return crypto.createHmac('sha256', deriveKey(kind)).update(payload).digest('base64url')
}

interface Payload {
  w?: unknown
  s?: unknown
  q?: unknown
  a?: unknown
  e?: unknown
}

function mint(
  kind: Kind,
  widgetToken: string,
  subject: string | number,
  ttlMs: number,
  now: number,
  text?: { q: string; a: string }
): string {
  const payload = Buffer.from(JSON.stringify({ w: widgetToken, s: subject, ...text, e: now + ttlMs })).toString('base64url')
  return `${payload}.${sign(kind, payload)}`
}

function verify(kind: Kind, token: unknown, widgetToken: string, now: number, maxChars: number): Payload | null {
  if (typeof token !== 'string' || token.length > maxChars) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const given = token.slice(dot + 1)
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(sign(kind, payload)).digest()
  if (!crypto.timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Payload
    if (parsed.w !== widgetToken) return null
    if (typeof parsed.e !== 'number' || parsed.e < now) return null
    if (typeof parsed.s !== 'string' && typeof parsed.s !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AnswerRef {
  answerId: string
  /** What the visitor asked, as this server saw it. */
  question: string
  /** What the widget replied. */
  answer: string
}

/** Null when there is no answer id to point at. */
export function mintAnswerToken(
  widgetToken: string,
  ref: AnswerRef,
  now = Date.now()
): string | null {
  if (!UUID.test(ref.answerId)) return null
  return mint('answer', widgetToken, ref.answerId, ANSWER_TOKEN_TTL_MS, now, {
    q: ref.question.slice(0, MAX_TOKEN_QUESTION_CHARS),
    a: ref.answer.slice(0, MAX_TOKEN_REPLY_CHARS),
  })
}

/** The answer inside a valid, unexpired token minted for this widget, else null. */
export function verifyAnswerToken(token: unknown, widgetToken: string, now = Date.now()): AnswerRef | null {
  const parsed = verify('answer', token, widgetToken, now, MAX_ANSWER_TOKEN_CHARS)
  if (!parsed || typeof parsed.s !== 'string' || !UUID.test(parsed.s)) return null
  return {
    answerId: parsed.s,
    question: typeof parsed.q === 'string' ? parsed.q : '',
    answer: typeof parsed.a === 'string' ? parsed.a : '',
  }
}

export function mintFlagToken(widgetToken: string, flagId: number, now = Date.now()): string {
  return mint('flag', widgetToken, flagId, FLAG_TOKEN_TTL_MS, now)
}

/** The flag id inside a valid, unexpired token minted for this widget, else null. */
export function verifyFlagToken(token: unknown, widgetToken: string, now = Date.now()): number | null {
  const parsed = verify('flag', token, widgetToken, now, 1024)
  const subject = parsed?.s
  return typeof subject === 'number' && Number.isInteger(subject) && subject > 0 ? subject : null
}
