/**
 * Status for "Stripe failed and this request cannot continue".
 *
 * Deliberately 500, not 502 or 504. Those two are the codes a reverse proxy
 * answers with when it cannot reach the app, and Cloudflare replaces any
 * origin response carrying one of them with its own HTML error page. The JSON
 * body naming what actually went wrong never reached the browser, so the
 * checkout page could only say "could not reach checkout" while the real
 * cause — a rejected Stripe parameter — sat in the server log. A 500 passes
 * through untouched.
 */
export const STRIPE_FAILURE_STATUS = 500
