// Shared between the settings action, the widget query layer, the chat route,
// and the widget UI — kept in one place so the three valid values can't drift
// out of sync between a server check and a client switch statement.
//
// See docs/product/widget.mdx "Lead capture" and GitHub issue #11.
export const WIDGET_LEAD_CAPTURE_MODES = ['off', 'on-failure', 'up-front'] as const

export type WidgetLeadCaptureMode = (typeof WIDGET_LEAD_CAPTURE_MODES)[number]

// 'on-failure' is the default for new rows (see the schema column and its
// migration): asking for an email only once an answer has actually failed is
// the behaviour issue #11 asks for. 'up-front' — the old hardcoded gate —
// stays available for teams that deliberately want it.
export const DEFAULT_WIDGET_LEAD_CAPTURE_MODE: WidgetLeadCaptureMode = 'on-failure'

export function isWidgetLeadCaptureMode(value: unknown): value is WidgetLeadCaptureMode {
  return (
    typeof value === 'string' &&
    (WIDGET_LEAD_CAPTURE_MODES as readonly string[]).includes(value)
  )
}

// Response header the chat route sets so the widget client knows, without
// parsing the model's prose, whether this turn is a candidate for the
// on-failure lead prompt. 'none' means the turn answered normally.
export const WIDGET_LEAD_SIGNAL_HEADER = 'X-Widget-Lead-Signal'

export const WIDGET_LEAD_SIGNALS = ['none', 'no-kb-match', 'human-requested'] as const

export type WidgetLeadSignal = (typeof WIDGET_LEAD_SIGNALS)[number]

// Deliberately not attempting a "low confidence" signal here: the widget chat
// agent has no confidence score anywhere in its pipeline today (see
// app/api/widget/chat/route.ts), and faking one would be exactly the kind of
// half-built signal the project's "no shortcuts" rule rules out. The two
// signals below are real and deterministic; low confidence can be added later
// if/when the pipeline actually produces a score to key off of.
const HUMAN_REQUEST_PATTERN =
  /\b(talk|speak|chat|connect|transfer)\s+(me\s+)?(to|with)\s+(a\s+|an\s+)?(human|person|agent|someone|rep|representative)\b|\b(real|live)\s+(human|person|agent)\b|\bhuman\s+support\b|\bcustomer\s+service\s+(rep|agent|representative)\b/i

/** Whether the visitor's message explicitly asks for a human. */
export function requestsHuman(query: string): boolean {
  return HUMAN_REQUEST_PATTERN.test(query)
}
