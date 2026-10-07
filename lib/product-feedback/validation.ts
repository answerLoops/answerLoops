// Shared by the widget (live character counter) and the server action, so the
// rules the user sees are exactly the rules enforced. Pure — no server imports.

export const FEEDBACK_MIN_CHARS = 35
export const FEEDBACK_MAX_CHARS = 500

export const FEEDBACK_STATUSES = ['pending', 'approved', 'rejected'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const REPLY_TAGS = ['great_feedback', 'planned', 'shipped', 'considering'] as const
export type ReplyTag = (typeof REPLY_TAGS)[number]

export const REPLY_TAG_LABELS: Record<ReplyTag, string> = {
  great_feedback: 'Great feedback',
  planned: 'Planned',
  shipped: 'Shipped',
  considering: 'Considering',
}

// Scheme, "www.", or a bare domain on a common TLD. The board is public to
// every workspace, so links are the main spam/phishing vector; blocking them
// outright is simpler and safer than trying to sanitise them.
const LINK_PATTERN =
  /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|dev|app|ai|me|xyz|ly|gg|info|biz|ru|cn|tk|link|click|top|site|online|shop)\b)/i

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text)
}

/** Returns an error message, or null when the feedback body is acceptable. */
export function validateFeedbackBody(raw: string): string | null {
  const body = raw.trim()
  if (body.length < FEEDBACK_MIN_CHARS) {
    return `Feedback needs at least ${FEEDBACK_MIN_CHARS} characters.`
  }
  if (body.length > FEEDBACK_MAX_CHARS) {
    return `Feedback can be at most ${FEEDBACK_MAX_CHARS} characters.`
  }
  if (containsLink(body)) return 'Links are not allowed in feedback.'
  return null
}

export function isReplyTag(value: unknown): value is ReplyTag {
  return typeof value === 'string' && (REPLY_TAGS as readonly string[]).includes(value)
}

/** Wire shape returned to the widget. Never carries user ids or emails. */
export interface BoardFeedback {
  id: number
  authorLabel: string
  body: string
  status: FeedbackStatus
  createdAt: string
  approvedAt: string | null
  mine: boolean
  reply: { body: string; tag: ReplyTag | null; repliedAt: string } | null
}

export interface BoardUpdate {
  id: number
  title: string
  body: string
  publishedAt: string
}

export interface BoardSnapshot {
  /** Approved feedback only — the number shown on the collapsed pill. */
  approvedCount: number
  feedback: BoardFeedback[]
  updates: BoardUpdate[]
}
