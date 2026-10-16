import { embedText } from '@/lib/ai/embed'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { recordReviewItem, type ReviewSource } from '@/lib/db/queries/kb-review'
import { logger } from '@/lib/logger'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const MOD = 'kb/review-capture'

const MAX_QUESTION_CHARS = 500
const MAX_ANSWER_CHARS = 4000

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Candidate phone-like runs: optional +, then digits with spaces, dots, dashes
// or brackets between them. Each candidate is checked by isPhoneNumber below.
const PHONE_CANDIDATE_RE = /(?<![\w.])\+?\(?\d[\d\s().-]{6,}\d(?![\w])/g
const ISO_DATE_START_RE = /^\d{4}-\d{1,2}-\d{1,2}/
const DOTTED_ONLY_RE = /^\d+(\.\d+)+$/

/**
 * True when a candidate run looks like a phone number: 9 to 15 digits and
 * either a leading + or country code, a bracketed area code, or separators
 * that form a plausible phone grouping. Dates, times, IP addresses and dotted
 * version strings are never phone numbers.
 */
function isPhoneNumber(m: string, before: string, after: string): boolean {
  const digits = m.replace(/\D/g, '').length
  if (digits < 9 || digits > 15) return false
  if (ISO_DATE_START_RE.test(m)) return false
  // Part of a clock time such as "12:30".
  if (/\d:$/.test(before) || /^:\d/.test(after)) return false

  const international = m.startsWith('+')
  if (!international && DOTTED_ONLY_RE.test(m) && m.split('.').length >= 4) return false
  if (international || /\(\d{2,4}\)/.test(m)) return true

  const groups = m.split(/[\s().-]+/).filter(Boolean)
  const separators = m.match(/[\s().-]+/g)?.length ?? 0
  if (separators >= 2) return groups.every((g) => g.length >= 2 && g.length <= 5) || groups.length >= 3
  // One separator (space or dash only): two substantial groups, e.g. "07911 123456".
  return separators === 1 && /^[\d]{3,8}[\s-]\d{3,8}$/.test(m)
}

// Only standalone digit runs: digits embedded in an identifier or token
// (a hash, a build id, "abc1234567x") are left as written.
const LONG_DIGITS_RE = /(?<!\w)\d{6,}(?!\w)/g

/**
 * Replaces email addresses, phone numbers and long digit runs (account,
 * order and card numbers) with neutral markers before text is stored.
 */
export function scrubPersonalData(text: string): string {
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_CANDIDATE_RE, (m, offset: number, whole: string) =>
      isPhoneNumber(m, whole.slice(Math.max(0, offset - 2), offset), whole.slice(offset + m.length, offset + m.length + 2)) ? '[phone]' : m
    )
    .replace(LONG_DIGITS_RE, '[number]')
}

/**
 * Puts an answer the assistant gave with no knowledge-base coverage into the
 * org's review queue, so a person can fine-tune it and approve it as an
 * article. Nothing captured here is served to anyone until that approval.
 *
 * Best-effort by design: it runs beside the live answer path (a ticket draft,
 * a widget reply) and must never fail or slow it, so every error is logged and
 * swallowed. Only orgs with the review-queue feature capture anything.
 */
export async function captureUnansweredQuestion(input: {
  orgId: number
  source: ReviewSource
  question: string
  answer: string
  ticketId?: number
  confidence?: number
  // Pass the vector when the caller already has it (the widget does) to skip a
  // second embedding call.
  embedding?: number[]
}): Promise<void> {
  try {
    const question = scrubPersonalData(parseAttachmentLines(input.question).text).trim().slice(0, MAX_QUESTION_CHARS)
    const answer = scrubPersonalData(input.answer).trim().slice(0, MAX_ANSWER_CHARS)
    // An empty answer is valid: the assistant had nothing usable, so the
    // reviewer writes one. Only the question is required.
    if (!question) return
    if (!(await orgHasFeature(input.orgId, 'kb_review_queue'))) return

    const embedding = input.embedding ?? (await embedText(question, input.orgId))
    const outcome = await recordReviewItem(
      {
        source: input.source,
        ticketId: input.ticketId ?? null,
        question,
        answer,
        embedding,
        confidence: input.confidence ?? null,
      },
      input.orgId
    )
    if (outcome === 'full') {
      logger.warn('review queue is full — unanswered question not captured', { module: MOD, orgId: input.orgId })
    }
  } catch (err) {
    logger.error('failed to capture unanswered question for review', {
      module: MOD,
      orgId: input.orgId,
      source: input.source,
      error: err,
    })
  }
}
