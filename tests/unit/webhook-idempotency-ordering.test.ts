import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Known Issues items 48 + 49 (Roadmap), both in app/api/billing/webhook/route.ts:
//   48. customer.subscription.updated / invoice.payment_failed fell back to
//       'standard' on an unresolvable price instead of preserving the
//       existing plan association.
//   49. No idempotency (Stripe retries can reprocess an event) or
//       event-ordering guard (an out-of-order delivery could overwrite
//       newer state with older state, e.g. resurrecting access after a
//       legitimate cancellation).
// Source-shape assertions, matching this repo's convention for this exact
// file (see tests/unit/plan-id-rename-infra.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

const src = () => readSrc('app/api/billing/webhook/route.ts')

describe('webhook idempotency (item 49a)', () => {
  it('imports the dedup functions from the queries layer', () => {
    const s = src()
    expect(s).toContain('claimWebhookEvent')
    expect(s).toContain('releaseWebhookEventClaim')
  })

  it('claims the event id atomically before the switch, and short-circuits on a duplicate', () => {
    const s = src()
    const checkIdx = s.indexOf('await claimWebhookEvent(event.id)')
    const switchIdx = s.indexOf('switch (event.type)')
    expect(checkIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(switchIdx)

    const checkBlock = s.slice(checkIdx, checkIdx + 260)
    expect(checkBlock).toContain('duplicate: true')
  })

  it('uses a transaction-level org claim for first-subscription welcome delivery', () => {
    const s = src()
    expect(s).toContain('upsertSubscriptionAndClaimWelcome')
    expect(s).toContain('const isFirstSubscription = await upsertSubscriptionAndClaimWelcome')
    expect(s).toContain('if (isFirstSubscription)')
  })
})

describe('webhook event-ordering guard (item 49b)', () => {
  it('defines isStaleEvent comparing event.created against a stored last-applied timestamp', () => {
    const s = src()
    expect(s).toContain('function isStaleEvent(')
    expect(s).toMatch(/lastAppliedEventCreated\s*!=\s*null\s*&&\s*event\.created\s*<=\s*lastAppliedEventCreated/)
  })

  it('applies the stale check in checkout.session.completed, subscription.updated, subscription.deleted, and invoice.payment_failed', () => {
    const s = src()
    const occurrences = [...s.matchAll(/isStaleEvent\(existingSub\?\.lastEventCreated, event\)/g)]
    expect(occurrences.length).toBe(3)
    // checkout.session.completed is guarded against the org's last applied event.
    const checkoutIdx = s.indexOf("case 'checkout.session.completed'")
    const updatedIdx = s.indexOf("case 'customer.subscription.updated'")
    expect(s.slice(checkoutIdx, updatedIdx)).toContain('isStaleEvent(existingForOrg?.lastEventCreated, event)')
  })

  it('releases the event claim when handling fails so the retry is processed', () => {
    const s = src()
    const catchIdx = s.indexOf("logger.error('Webhook handler error'")
    expect(s.slice(catchIdx, catchIdx + 260)).toContain('releaseWebhookEventClaim(event.id)')
  })

  it('threads lastEventCreated: event.created into every upsertSubscription call', () => {
    const s = src()
    const upsertCallCount = [...s.matchAll(/await upsertSubscription\(\{/g)].length
    const lastEventCreatedCount = [...s.matchAll(/lastEventCreated: event\.created/g)].length
    // subscription.updated, subscription.deleted, invoice.payment_failed;
    // checkout.completed uses the transaction-level first-subscription helper.
    expect(upsertCallCount).toBe(3)
    expect(lastEventCreatedCount).toBe(4)
  })
})

describe('subscription.updated preserves existing plan on unresolvable price (item 48), never fabricates one (item 65)', () => {
  it('fetches the existing row before computing planId, and prefers it over a hardcoded fallback', () => {
    const s = src()
    const updatedCaseIdx = s.indexOf("case 'customer.subscription.updated'")
    const deletedCaseIdx = s.indexOf("case 'customer.subscription.deleted'")
    const updatedCase = s.slice(updatedCaseIdx, deletedCaseIdx)

    expect(updatedCase).toContain('const existingSub = await getSubscriptionByStripeId(sub.id)')
    expect(updatedCase).toContain("const planId = plan?.id ?? existingSub!.planId")
  })

  it('skips the write instead of defaulting to standard when there is no resolvable price and no existing row', () => {
    const s = src()
    const updatedCaseIdx = s.indexOf("case 'customer.subscription.updated'")
    const deletedCaseIdx = s.indexOf("case 'customer.subscription.deleted'")
    const updatedCase = s.slice(updatedCaseIdx, deletedCaseIdx)

    expect(updatedCase).toMatch(/if \(!plan && !existingSub\) \{[\s\S]*?break\s*\}/)
    expect(updatedCase).not.toMatch(/planId:\s*existingSub\?\.planId\s*\?\?\s*'standard'/)
  })
})

describe('lib/db/queries/billing.ts — dedup + ordering support', () => {
  const querySrc = () => readSrc('lib/db/queries/billing.ts')

  it('exposes lastEventCreated on Subscription and through upsertSubscription', () => {
    const s = querySrc()
    expect(s).toContain('lastEventCreated: number | null')
    expect(s).toContain('lastEventCreated?: number | null')
  })

  it('exposes pruneOldWebhookEvents', () => {
    const s = querySrc()
    expect(s).toContain('export async function pruneOldWebhookEvents(')
  })

  it('serializes first-subscription claims per org', () => {
    const s = querySrc()
    expect(s).toContain('export async function upsertSubscriptionAndClaimWelcome(')
    expect(s).toContain('pg_advisory_xact_lock(8451')
    expect(s).toContain('return !existing')
  })
})

describe('drizzle/0023_webhook_idempotency.sql', () => {
  it('creates webhook_events and adds subscriptions.last_event_created, idempotently', () => {
    const s = readSrc('drizzle/0023_webhook_idempotency.sql')
    expect(s).toContain('CREATE TABLE IF NOT EXISTS webhook_events')
    expect(s).toContain('event_id TEXT PRIMARY KEY')
    expect(s).toContain('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_event_created INTEGER')
  })
})
