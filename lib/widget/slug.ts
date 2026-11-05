// The stable public identifier an owner can put in the embed snippet instead of
// the rotating widget token. Public by design, exactly like the token: it only
// changes how rotation is experienced, not who is trusted.

// Widget tokens are 48 lowercase hex characters (lib/db/queries/widgets.ts).
// Kept here so the loader's "is this id a token or a slug" decision and the
// slug rules below cannot drift apart.
export const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

export const WIDGET_SLUG_MIN_LENGTH = 3
// Below the 48-character token length on purpose: a valid slug can then never
// be mistaken for a token, so one parameter can carry either.
export const WIDGET_SLUG_MAX_LENGTH = 40

// Lowercase letters, digits and single hyphens between them. No leading or
// trailing hyphen.
const WIDGET_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Names that read as part of the product or its routes rather than a customer.
const RESERVED_SLUGS = new Set([
  'admin',
  'answerloops',
  'api',
  'app',
  'config',
  'demo',
  'docs',
  'help',
  'login',
  'preview',
  'support',
  'test',
  'widget',
])

export type WidgetSlugCheck = { ok: true; slug: string } | { ok: false; error: string }

/** Lowercase and trim what a person typed, before it is checked or stored. */
export function normalizeWidgetSlug(value: string): string {
  return value.trim().toLowerCase()
}

/** Whether a value has the shape of a slug. Says nothing about availability. */
export function isWidgetSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= WIDGET_SLUG_MIN_LENGTH &&
    value.length <= WIDGET_SLUG_MAX_LENGTH &&
    WIDGET_SLUG_PATTERN.test(value) &&
    !RESERVED_SLUGS.has(value)
  )
}

export function validateWidgetSlug(raw: string): WidgetSlugCheck {
  const slug = normalizeWidgetSlug(raw)
  if (slug.length < WIDGET_SLUG_MIN_LENGTH || slug.length > WIDGET_SLUG_MAX_LENGTH) {
    return {
      ok: false,
      error: `Use ${WIDGET_SLUG_MIN_LENGTH} to ${WIDGET_SLUG_MAX_LENGTH} characters.`,
    }
  }
  if (!WIDGET_SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: 'Use only lowercase letters, numbers and single hyphens, and start and end with a letter or number.',
    }
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: 'That name is reserved. Try another.' }
  return { ok: true, slug }
}
