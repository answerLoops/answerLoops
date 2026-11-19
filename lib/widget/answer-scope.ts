// What the website chat widget may draw on when it answers, and the optional
// note a workspace owner can leave about tone and next steps. Shared by the
// settings actions, the widget query layer, the chat route and the settings UI
// so the valid values and limits cannot drift between a server check and a
// client control.
//
// See content/docs/product/chat-widget.mdx, "What the widget answers from".

/**
 * - `general`: answers from the knowledge base and, when nothing in it covers
 *   the question, from the model's general knowledge. This is how every widget
 *   behaved before the setting existed, so it is what existing workspaces keep.
 * - `knowledge-base-only`: answers only from the published knowledge base. A
 *   question it does not cover gets an honest "I don't have that" and a pointer
 *   to support, and requests unrelated to the workspace are declined. The right
 *   choice for a widget anyone on the internet can use, where an answer is
 *   read as the company speaking.
 */
export const WIDGET_ANSWER_SCOPES = ['general', 'knowledge-base-only'] as const

export type WidgetAnswerScope = (typeof WIDGET_ANSWER_SCOPES)[number]

/** What a workspace has until its owner changes it: the behaviour it already had. */
export const DEFAULT_WIDGET_ANSWER_SCOPE: WidgetAnswerScope = 'general'

/**
 * What a read path uses when a stored value is missing or unrecognised. The
 * column is only ever written through a validated setter, so a bad value means
 * somebody edited the row by hand, and the safe reading of an unclear request
 * to limit what a public widget says is the narrower one.
 */
export const SAFE_WIDGET_ANSWER_SCOPE_FALLBACK: WidgetAnswerScope = 'knowledge-base-only'

export function isWidgetAnswerScope(value: unknown): value is WidgetAnswerScope {
  return typeof value === 'string' && (WIDGET_ANSWER_SCOPES as readonly string[]).includes(value)
}

/**
 * Longest guidance note accepted. It is added to every answer's instructions,
 * so it costs tokens on each turn, and a short note is easier for the model to
 * follow than a long one.
 */
export const WIDGET_GUIDANCE_MAX_CHARS = 600

export type GuidanceResult = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * Cleans a guidance note before it is stored. An empty note is stored as null,
 * meaning "no guidance". Control characters other than line breaks are dropped
 * and runs of blank lines are collapsed, so what is stored is what a person
 * would have typed, not whatever a paste carried along.
 */
export function normalizeWidgetGuidance(raw: unknown): GuidanceResult {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Invalid guidance' }
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned.length === 0) return { ok: true, value: null }
  if (cleaned.length > WIDGET_GUIDANCE_MAX_CHARS) {
    return { ok: false, error: `Keep guidance under ${WIDGET_GUIDANCE_MAX_CHARS} characters` }
  }
  return { ok: true, value: cleaned }
}
