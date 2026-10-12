import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Bug: neither app/api/billing/checkout/route.ts nor
// app/api/billing/portal/route.ts caught errors from the Stripe SDK calls
// they make. A Stripe-side failure (bad API key, an unrecognized price,
// a transient outage) crashed the route to an empty 500 body. The client
// hooks (components/billing/use-upgrade.ts and the billing page's inline
// portal fetch) always call response.json() on the result, so an empty
// body threw its own unrelated SyntaxError inside a React transition and
// got silently swallowed — the user was left looking at a dead page with
// no indication anything went wrong, indistinguishable from a 404.
// Fixed by wrapping the Stripe calls and always returning a real JSON
// error, which both client call sites already know how to display.
// Source-shape assertions, matching this repo's convention for these
// exact files (see tests/unit/webhook-idempotency-ordering.test.ts).

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

// The checkout session creation moved into lib/billing/checkout.ts so the
// signup path can call it server-side without a client round trip. The property
// under test is unchanged — a Stripe failure must produce a readable JSON error
// rather than an empty body — so these assertions now point at the file that
// actually owns it. The route is asserted separately below to confirm it still
// surfaces what the helper returns.
describe('lib/billing/checkout.ts — Stripe failures return a real error, never an empty body', () => {
  const src = read('lib/billing/checkout.ts')

  it('wraps the Stripe call in try/catch', () => {
    expect(src).toMatch(/try\s*{[\s\S]*stripe\.checkout\.sessions\.create[\s\S]*}\s*catch/)
  })

  it('returns a structured error with a non-500 status on failure, never an empty body', () => {
    const catchIdx = src.indexOf('} catch (err) {')
    expect(catchIdx).toBeGreaterThan(-1)
    // Wide enough to reach the return past the structured logger call.
    const catchBlock = src.slice(catchIdx, catchIdx + 700)
    // The helper returns a result object; the route turns it into the JSON
    // response. Both halves matter, so both are asserted — here, and in the
    // route describe below.
    expect(catchBlock).toContain('ok: false')
    expect(catchBlock).toContain('error:')
    expect(catchBlock).toMatch(/status:\s*STRIPE_FAILURE_STATUS/)
  })

  it('logs the failure server-side before responding', () => {
    const catchIdx = src.indexOf('} catch (err) {')
    const catchBlock = src.slice(catchIdx, catchIdx + 400)
    expect(catchBlock).toContain('logger.error(')
  })
})

describe('app/api/billing/portal/route.ts — Stripe failures return a real JSON error', () => {
  const src = read('app/api/billing/portal/route.ts')

  it('wraps the Stripe call in try/catch', () => {
    expect(src).toMatch(/try\s*{[\s\S]*stripe\.billingPortal\.sessions\.create[\s\S]*}\s*catch/)
  })

  it('returns a JSON error with a non-500 status on failure, never an empty body', () => {
    const catchIdx = src.indexOf('} catch (err) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBlock = src.slice(catchIdx)
    expect(catchBlock).toContain('NextResponse.json({ error:')
    expect(catchBlock).toMatch(/status:\s*STRIPE_FAILURE_STATUS/)
  })

  it('logs the failure server-side before responding', () => {
    const catchIdx = src.indexOf('} catch (err) {')
    const catchBlock = src.slice(catchIdx)
    expect(catchBlock).toContain('logger.error(')
  })
})

// The route no longer creates the session itself, so this confirms it still
// surfaces the helper's error and status rather than swallowing them.
describe('app/api/billing/checkout/route.ts — surfaces the helper result', () => {
  const routeSrc = read('app/api/billing/checkout/route.ts')

  it('returns the helper error with its status', () => {
    expect(routeSrc).toContain('createCheckoutSession')
    expect(routeSrc).toContain('NextResponse.json({ error: result.error }, { status: result.status })')
  })

  it('still rejects unauthenticated callers and self-hosted deployments', () => {
    expect(routeSrc).toContain("status: 401")
    expect(routeSrc).toContain('stripeConfigured()')
  })
})
