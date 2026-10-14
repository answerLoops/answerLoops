// Kept free of server imports so the checkout panel can validate what someone
// typed before it is sent anywhere.

// Promotion codes are short human-typed strings. Anything outside this shape is
// never sent to Stripe: the value arrives in a query string or a request body
// and ends up in an API call and a redirect target, so it is narrowed at every
// edge it crosses.
const PROMO_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function parsePromoCode(value: string | null | undefined): string | null {
  return value && PROMO_CODE_PATTERN.test(value) ? value : null
}
