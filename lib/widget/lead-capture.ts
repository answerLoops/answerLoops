// Shared between the settings action, the widget query layer, the chat route,
// the lead-signal lookup route, and the widget UI — kept in one place so the
// three valid modes and three valid signals can't drift out of sync between a
// server check and a client switch statement.
//
// See docs/product/chat-widget.mdx "Lead capture" and GitHub issue #11.
export const WIDGET_LEAD_CAPTURE_MODES = ['off', 'on-failure', 'up-front'] as const

export type WidgetLeadCaptureMode = (typeof WIDGET_LEAD_CAPTURE_MODES)[number]

// Asking for an email only once an answer has actually failed is the
// behaviour issue #11 asks for, so this is what a *new* workspace gets, set
// explicitly at org creation — see auth.ts. It is deliberately NOT the schema
// column's own DB-level default: that stays 'up-front' so every workspace
// that existed before this feature shipped keeps the behaviour it already
// had rather than silently changing underneath it. 'up-front' — the old
// hardcoded gate — stays available for teams that deliberately want it.
//
// This is for new-org creation ONLY. A read path that falls back because a
// stored value is missing or corrupted must use
// SAFE_WIDGET_LEAD_CAPTURE_MODE_FALLBACK instead (see below) — an existing
// workspace with a damaged row should fall back to the behaviour it already
// had, not silently gain the on-failure prompt it never opted into.
export const DEFAULT_WIDGET_LEAD_CAPTURE_MODE: WidgetLeadCaptureMode = 'on-failure'

// What a read path falls back to when a stored widget_lead_capture_mode value
// is missing, unreadable, or otherwise fails isWidgetLeadCaptureMode — kept
// equal to the schema column's own DB-level default (see lib/db/schema.ts)
// so a damaged row for an existing org resolves to the behaviour that org
// already had, not to DEFAULT_WIDGET_LEAD_CAPTURE_MODE's new-org behaviour.
export const SAFE_WIDGET_LEAD_CAPTURE_MODE_FALLBACK: WidgetLeadCaptureMode = 'up-front'

export function isWidgetLeadCaptureMode(value: unknown): value is WidgetLeadCaptureMode {
  return (
    typeof value === 'string' &&
    (WIDGET_LEAD_CAPTURE_MODES as readonly string[]).includes(value)
  )
}

// What a finished widget turn is tagged with, stashed server-side in
// app/api/widget/chat/route.ts's onFinish and read back by
// app/api/widget/lead-signal/route.ts. 'none' means the turn answered
// normally and the on-failure prompt should not appear.
export const WIDGET_LEAD_SIGNALS = ['none', 'no-kb-match', 'human-requested'] as const

export type WidgetLeadSignal = (typeof WIDGET_LEAD_SIGNALS)[number]

export function isWidgetLeadSignal(value: unknown): value is WidgetLeadSignal {
  return typeof value === 'string' && (WIDGET_LEAD_SIGNALS as readonly string[]).includes(value)
}

// Deliberately not attempting a "low confidence" signal here: the widget chat
// agent has no confidence score anywhere in its pipeline today (see
// app/api/widget/chat/route.ts), and faking one would be exactly the kind of
// half-built signal the project's "no shortcuts" rule rules out. The two
// signals below are real and deterministic; low confidence can be added later
// if/when the pipeline actually produces a score to key off of.
// "connect"/"transfer"/"get" only count when aimed at the visitor ("connect
// ME to an agent"): "how do I connect to an agent" or "transfer a call to an
// agent" are real API/integration questions in this product's own domain, and
// the word "me" is what separates a request for a person from a question about
// the product. "talk/speak/chat to ..." has no such second meaning, so it keeps
// the full noun list.
const HUMAN_NOUN = '(?:a\\s+|an\\s+|the\\s+)?(?:human|person|agent|someone|somebody|rep|representative|manager|supervisor|support)'
const HUMAN_REQUEST_PATTERN = new RegExp(
  [
    `\\b(?:talk|speak|chat)\\s+(?:me\\s+)?(?:to|with)\\s+${HUMAN_NOUN}\\b`,
    `\\b(?:connect|transfer|put|get|pass|route|escalate)\\s+me\\s+(?:to|with|through\\s+to|over\\s+to)\\s+${HUMAN_NOUN}\\b`,
    `\\b(?:i\\s+(?:need|want)|can\\s+i\\s+(?:get|have|see)|get\\s+me)\\s+(?:a\\s+|an\\s+)(?:human|real\\s+person|live\\s+person|rep|representative|manager)\\b`,
    `\\b(?:real|live)\\s+(?:human|person|agent)\\b`,
    `\\bhuman\\s+support\\b`,
    `\\bcustomer\\s+service\\s+(?:rep|agent|representative)\\b`,
    `\\bcontact\\s+(?:support|customer\\s+service|a\\s+human)\\b`,
  ].join('|'),
  'i'
)

/** Whether the visitor's message explicitly asks for a human. */
export function requestsHuman(query: string): boolean {
  return HUMAN_REQUEST_PATTERN.test(query)
}

// A bare greeting or acknowledgement ("hi", "thanks!", "ok cool") finds no
// knowledge-base match for the same reason any non-question would — there is
// nothing in it to match — but that is not a failed answer, so it should not
// trigger the on-failure prompt. The repeated group (rather than a single
// word) is what lets "ok cool" or "thanks, bye" match as a run of ack words
// instead of only ever one. \b after each alternative stops a word like "ok"
// matching as a prefix of an unrelated longer word. Anchored to the whole
// (trimmed) message rather than matched anywhere in it, so a real question
// that happens to start with "thanks for the help, but..." still counts
// normally — "for" isn't in the word list, so the run stops there and the
// match fails to reach the end of the string.
const GREETING_OR_ACK_PATTERN =
  /^(?:(?:hi+|hello+|hey+|yo|sup|howdy|good\s+(?:morning|afternoon|evening|day)|no\s+thanks?(?:\s+you)?|thanks?(?:\s+you)?(?:\s+(?:so|very)\s+much|\s+a\s+lot)?|thx|ty|ok(?:ay)?|k|cool|great|nice|got it|sounds good|perfect|awesome|bye|goodbye|see\s*ya|cheers)\b[!.,?\s]*)+$/i

/** Whether the message is a bare greeting/acknowledgement with nothing to look up. */
export function isGreetingOrAck(query: string): boolean {
  return GREETING_OR_ACK_PATTERN.test(query.trim())
}
