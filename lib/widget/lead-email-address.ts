/**
 * Whether a visitor's email address is one we accept as a lead. Deliberately
 * stricter than "looks like an email": a lead address ends up in an email to a
 * workspace's team and on their Leads page, so anything that is not a plain,
 * ordinary address is refused instead of being stored and passed along.
 *
 * Accepted: one @; a local part of letters, digits and . _ + - that never
 * starts, ends or doubles up on a punctuation mark; a domain of at least two
 * dot-separated labels of letters, digits and hyphens (no label starting or
 * ending with a hyphen); and a top-level part of 2 to 24 letters. Plain ASCII
 * only. Refused: spaces, quotes, angle brackets, slashes, backslashes, commas,
 * semicolons, percent signs, brackets, control characters, an IP address as
 * the domain, and anything over 254 characters (64 for the local part).
 *
 * Expects the caller to have trimmed and lower-cased the value.
 */
const MAX_ADDRESS_CHARS = 254
const MAX_LOCAL_CHARS = 64

const LOCAL_PART = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TOP_LEVEL = /^[a-z]{2,24}$/

export function isAcceptableLeadEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length < 6 || value.length > MAX_ADDRESS_CHARS) return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (local.length === 0 || local.length > MAX_LOCAL_CHARS || !LOCAL_PART.test(local)) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false
  return TOP_LEVEL.test(labels[labels.length - 1])
}
