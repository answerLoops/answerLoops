/**
 * Shape checks shared by every public widget endpoint
 * (app/api/widget/chat, .../lead, .../lead-signal) — widget tokens and
 * visitor ids are validated identically in all three before either value is
 * used as rate-limit bucket key material or a DB lookup parameter.
 */

// Widget tokens are crypto.randomBytes(24).toString('hex') — see
// lib/db/queries/widgets.ts.
const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

export function isValidWidgetToken(value: unknown): value is string {
  return typeof value === 'string' && WIDGET_TOKEN_PATTERN.test(value)
}

// The widget generates a UUID (36 chars) per browser. Accepted shape is
// letters, digits, hyphen and underscore up to 64 chars: wide enough for any
// UUID form, and it excludes the `:` that delimits the memory key built from
// this value (`widget:<orgId>:<visitorId>`).
const MAX_VISITOR_ID_LEN = 64
const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function isValidVisitorId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VISITOR_ID_LEN && VISITOR_ID_PATTERN.test(value)
}

// The per-tab session id has the same shape as a visitor id (a client-generated
// UUID) and the same ':'-free guarantee, so it shares the check.
export const isValidSessionId = isValidVisitorId
