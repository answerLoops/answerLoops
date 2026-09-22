import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Owner-initiated account deletion: soft-delete with a 30-day grace period
// (Known Issue 68 on the Roadmap), not immediate hard-delete — matches the
// industry pattern (Stripe cancel-at-period-end, GitHub's repo-deletion
// delay). Deleting an org touches ~20 FK-dependent tables, several of which
// have no ON DELETE CASCADE/SET NULL at the DB level, so wrong deletion
// order is a real correctness risk (a Postgres foreign-key violation), not
// just a style nit — hence the ordering assertions below.
//
// Source-file structural assertions — same convention as
// infra-discord-oauth.test.ts and plan-id-rename-infra.test.ts (Next.js
// route/server-action modules can't be safely imported here without pulling
// in real DB/auth/Stripe clients). hardPurgeOrg is straight-line sequential
// code with no concurrency to distinguish (unlike the advisory-lock
// reservation logic in auto-deflect-reservation.test.ts, which genuinely
// needs a pg-proxy dual-handle trick to tell "looks right in source" apart
// from "actually happens on the right transaction") — so source-order here
// legitimately is execution order, and position-based string assertions are
// sufficient rather than a proportionality shortfall.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

function posOf(haystack: string, needle: string, from = 0): number {
  const idx = haystack.indexOf(needle, from)
  expect(idx, `Expected to find "${needle}" in source`).toBeGreaterThanOrEqual(0)
  return idx
}

describe('migration: orgs.deleted_at', () => {
  it('adds a nullable timestamptz column, idempotently', () => {
    const src = read('drizzle/0024_org_soft_delete.sql')
    expect(src).toContain('ALTER TABLE orgs ADD COLUMN IF NOT EXISTS deleted_at timestamptz')
    // Nullable and no DEFAULT — every existing row must read as "active"
    // (NULL) without a backfill statement.
    expect(src).not.toMatch(/deleted_at timestamptz NOT NULL/i)
    expect(src).not.toMatch(/deleted_at timestamptz.*DEFAULT/i)
  })
})

describe('schema: orgs.deletedAt', () => {
  it('is a nullable, timezone-aware timestamp column', () => {
    const src = read('lib/db/schema.ts')
    expect(src).toContain("deletedAt: timestamp('deleted_at', { withTimezone: true })")
  })
})

describe('lib/db/queries/orgs.ts: soft-delete lifecycle', () => {
  const src = read('lib/db/queries/orgs.ts')

  it('exports a 30-day grace period constant', () => {
    expect(src).toContain('export const ORG_PURGE_GRACE_DAYS = 30')
  })

  it('softDeleteOrg sets deletedAt, restoreOrg clears it', () => {
    const softIdx = src.indexOf('export async function softDeleteOrg')
    expect(softIdx).toBeGreaterThanOrEqual(0)
    expect(src.slice(softIdx, src.indexOf('\n}', softIdx))).toContain('deletedAt: new Date()')

    const restoreIdx = src.indexOf('export async function restoreOrg')
    expect(restoreIdx).toBeGreaterThanOrEqual(0)
    expect(src.slice(restoreIdx, src.indexOf('\n}', restoreIdx))).toContain('deletedAt: null')
  })

  it('getOrgsPendingPurge only returns orgs past the full grace period', () => {
    const idx = src.indexOf('export async function getOrgsPendingPurge')
    const body = src.slice(idx, src.indexOf('\n}', idx))
    expect(body).toContain('isNotNull(orgs.deletedAt)')
    expect(body).toContain('lt(orgs.deletedAt, cutoff)')
  })

  it('hardPurgeOrg runs entirely inside one transaction', () => {
    const idx = src.indexOf('export async function hardPurgeOrg')
    const body = src.slice(idx)
    expect(body).toContain('getDb().transaction(async (tx) =>')
    // Every delete in the purge must use the transaction handle, not the
    // pooled one — a single stray `db.delete(...)`/bare `.delete(` outside
    // `tx.` would let a partial failure leave the org half-purged instead of
    // rolling back atomically.
    const deleteCalls = body.match(/\.delete\(/g) ?? []
    const txDeleteCalls = body.match(/tx\.delete\(/g) ?? []
    expect(deleteCalls.length).toBeGreaterThan(15) // sanity: this really is the big multi-table purge
    expect(txDeleteCalls.length).toBe(deleteCalls.length)
  })

  it('never deletes from the users table — identities outlive their org', () => {
    const idx = src.indexOf('export async function hardPurgeOrg')
    const body = src.slice(idx)
    expect(body).not.toMatch(/delete\(users\)/)
  })

  describe('deletion order — rows with no ON DELETE CASCADE/SET NULL must go before what they reference', () => {
    const idx = src.indexOf('export async function hardPurgeOrg')
    const body = src.slice(idx)

    it('kbArticles (sourceTicketId → tickets, no cascade) is deleted before tickets', () => {
      const kbPos = posOf(body, 'tx.delete(kbArticles)')
      const ticketsPos = posOf(body, 'tx.delete(tickets)')
      expect(kbPos).toBeLessThan(ticketsPos)
    })

    it('notifications (ticketId → tickets, no cascade) is deleted before tickets', () => {
      const notifPos = posOf(body, 'tx.delete(notifications)')
      const ticketsPos = posOf(body, 'tx.delete(tickets)')
      expect(notifPos).toBeLessThan(ticketsPos)
    })

    it('csatRatings (ticketId → tickets, no cascade) is deleted before tickets', () => {
      const csatPos = posOf(body, 'tx.delete(csatRatings)')
      const ticketsPos = posOf(body, 'tx.delete(tickets)')
      expect(csatPos).toBeLessThan(ticketsPos)
    })

    it('apiGenerations (keyId → apiKeys, no cascade) is deleted before apiKeys', () => {
      const genPos = posOf(body, 'tx.delete(apiGenerations)')
      const keysPos = posOf(body, 'tx.delete(apiKeys)')
      expect(genPos).toBeLessThan(keysPos)
    })

    it('every direct ticket-child table is deleted before tickets, and only when the org actually has tickets', () => {
      const ticketsPos = posOf(body, 'tx.delete(tickets)')
      const guardPos = posOf(body, 'if (ticketIds.length > 0)')
      expect(guardPos).toBeLessThan(ticketsPos)

      for (const table of [
        'ticketReplies',
        'ticketEvents',
        'ticketEmbeddings',
        'ticketLinks',
        'ticketFeedback',
        'answerMessages',
        'aiAssessments',
        'csatMessages',
      ]) {
        const pos = posOf(body, `tx.delete(${table})`, guardPos)
        expect(pos).toBeLessThan(ticketsPos)
      }
    })

    it('ticketLinks is cleared on both FK columns (ticketId and relatedId)', () => {
      expect(body).toContain('tx.delete(ticketLinks).where(inArray(ticketLinks.ticketId, ticketIds))')
      expect(body).toContain('tx.delete(ticketLinks).where(inArray(ticketLinks.relatedId, ticketIds))')
    })

    it('memberships is deleted before the org row itself', () => {
      const membershipsPos = posOf(body, 'tx.delete(memberships)')
      const orgsPos = posOf(body, 'tx.delete(orgs)')
      expect(membershipsPos).toBeLessThan(orgsPos)
    })

    it('orgs is the very last delete in the transaction', () => {
      const orgsPos = body.lastIndexOf('tx.delete(orgs)')
      const allDeletePositions = [...body.matchAll(/tx\.delete\(/g)].map((m) => m.index ?? -1)
      const maxOtherPos = Math.max(...allDeletePositions.filter((p) => p !== orgsPos))
      expect(orgsPos).toBeGreaterThan(maxOtherPos)
    })
  })
})

describe('lib/billing/stripe.ts: cancelSubscriptionImmediately', () => {
  const src = read('lib/billing/stripe.ts')

  it('cancels now, not at period end', () => {
    expect(src).toContain('subscriptions.cancel(stripeSubscriptionId)')
  })

  it('swallows only resource_missing, not every error', () => {
    const idx = src.indexOf('export async function cancelSubscriptionImmediately')
    const body = src.slice(idx, src.indexOf('\n}', idx))
    expect(body).toContain("code === 'resource_missing'")
    expect(body).toContain('throw err')
  })
})

describe('lib/actions/account.ts: owner-gating and billing-before-deletion ordering', () => {
  const src = read('lib/actions/account.ts')

  it('deleteAccountAction and restoreAccountAction are owner-only', () => {
    expect(src).toContain("const OWNER_ONLY = ['owner'] as const")
    const deleteIdx = src.indexOf('export async function deleteAccountAction')
    expect(src.slice(deleteIdx, src.indexOf('\n}', deleteIdx + 200))).toContain('requireOrgAccess(OWNER_ONLY)')
    const restoreIdx = src.indexOf('export async function restoreAccountAction')
    expect(src.slice(restoreIdx)).toContain('requireOrgAccess(OWNER_ONLY)')
  })

  it('requires the typed confirmation to exactly match the real org name', () => {
    expect(src).toContain('parsed.data.confirmName.trim() !== org.name')
  })

  it('cancels Stripe billing before marking the org deleted, not after', () => {
    const deleteIdx = src.indexOf('export async function deleteAccountAction')
    const body = src.slice(deleteIdx)
    const cancelPos = posOf(body, 'cancelSubscriptionImmediately(')
    const softDeletePos = posOf(body, 'softDeleteOrg(access.orgId)')
    expect(cancelPos).toBeLessThan(softDeletePos)
  })

  it('signs the user out after soft-deleting, so access ends the same request', () => {
    const deleteIdx = src.indexOf('export async function deleteAccountAction')
    const body = src.slice(deleteIdx)
    const softDeletePos = posOf(body, 'softDeleteOrg(access.orgId)')
    const signOutPos = posOf(body, "signOut({ redirectTo: '/login' })")
    expect(softDeletePos).toBeLessThan(signOutPos)
  })

  it('a failed Stripe cancellation blocks the deletion instead of silently proceeding', () => {
    const deleteIdx = src.indexOf('export async function deleteAccountAction')
    const body = src.slice(deleteIdx)
    const catchIdx = posOf(body, 'catch (err) {', posOf(body, 'cancelSubscriptionImmediately('))
    const softDeletePos = posOf(body, 'softDeleteOrg(access.orgId)')
    const returnErrorPos = posOf(body, 'return { error:', catchIdx)
    expect(catchIdx).toBeLessThan(returnErrorPos)
    expect(returnErrorPos).toBeLessThan(softDeletePos)
  })
})

describe('auth.ts: soft-deleted orgs lose access immediately, live-checked (not cached in the JWT)', () => {
  const src = read('auth.ts')
  // The live org/membership query moved into lib/auth/membership.ts when the
  // same gate gained a membership check; auth.ts now maps its result onto a
  // response. Assertions that named auth.ts's own query text broke on that
  // refactor while the property they guard was untouched, so each one now
  // points at whichever file actually owns the behaviour.
  const gateSrc = read('lib/auth/membership.ts')

  it('checks org.deletedAt on every request rather than trusting a stamped session flag', () => {
    // Unlike `onboarded` (only ever flips false→true, safe to cache), a
    // deletion has to take effect against a JWT issued before it happened —
    // so this must be a live DB read every request, not a token field.
    expect(src).not.toMatch(/session\.deletedAt/)
    expect(gateSrc).toContain('deletedAt: orgs.deletedAt')
    // And auth.ts must actually consult it, not merely import the resolver.
    expect(src).toContain('resolveOrgAccess')
    expect(src).toContain("access.status === 'org-deleted'")
  })

  it('exempts only the account-deleted page itself from the deletion redirect, so its own restore action stays reachable', () => {
    expect(src).toContain("if (pathname !== ACCOUNT_DELETED_PATH) {")
  })

  it('API routes get a 403 JSON response, not a browser redirect', () => {
    const idx = src.indexOf("if (access.status === 'org-deleted') {")
    expect(idx, 'deleted-org branch not found in the request gate').toBeGreaterThan(-1)
    const body = src.slice(idx, idx + 400)
    expect(body).toContain("pathname.startsWith('/api/')")
    expect(body).toContain('status: 403 }')
  })

  it('page routes redirect to the account-deleted page', () => {
    const idx = src.indexOf("if (access.status === 'org-deleted') {")
    const body = src.slice(idx, idx + 400)
    // Built from incomingOrigin, not request.nextUrl — the latter is
    // normalized by NextAuth's edge wrapper to AUTH_URL's origin regardless of
    // the actual incoming host, which would send a split-host deployment's
    // app-subdomain visitor back to the marketing domain for this redirect.
    // See the comment above incomingOrigin's definition in auth.ts.
    expect(body).toContain('NextResponse.redirect(new URL(ACCOUNT_DELETED_PATH, incomingOrigin))')
    expect(body).not.toContain('request.nextUrl))')
  })

  it('the deletion check runs before the onboarding check, so a deleted org never gets routed to /onboarding instead', () => {
    const deletedCheckPos = posOf(src, "if (access.status === 'org-deleted') {")
    const onboardingCheckPos = posOf(src, "pathname !== ONBOARDING_PATH")
    expect(deletedCheckPos).toBeLessThan(onboardingCheckPos)
  })

  it('a removed member is denied before the org-state branches are consulted', () => {
    // Ordering guard for the new membership check: a former member must not be
    // routed to the account-deleted page for an org they no longer belong to.
    const notMemberPos = posOf(gateSrc, "return { status: 'not-member' }")
    const deletedPos = posOf(gateSrc, "return { status: 'org-deleted' }")
    expect(notMemberPos).toBeLessThan(deletedPos)
  })
})

describe('bot/index.ts: background purge sweep', () => {
  const src = read('bot/index.ts')

  it('runs independently of Discord/Slack, on its own interval', () => {
    expect(src).toContain('function startOrgPurgeSweep')
    expect(src).toContain('startOrgPurgeSweep()')
    expect(src).toContain('setInterval(() => { sweep().catch(() => {}) }, ORG_PURGE_SWEEP_INTERVAL_MS)')
  })

  it('one org failing to purge does not stop the sweep or crash the process', () => {
    const idx = src.indexOf('function startOrgPurgeSweep')
    const body = src.slice(idx, src.indexOf('\nfunction ', idx + 10) === -1 ? undefined : src.indexOf('\nfunction ', idx + 10))
    expect(body).toContain('for (const orgId of orgIds)')
    const forIdx = body.indexOf('for (const orgId of orgIds)')
    expect(body.slice(forIdx)).toContain('try {')
    expect(body.slice(forIdx)).toContain('await hardPurgeOrg(orgId)')
  })

  it('runs an immediate sweep on startup, not just after the first interval elapses', () => {
    const idx = src.indexOf('function startOrgPurgeSweep')
    const body = src.slice(idx, src.indexOf('setInterval', idx))
    expect(body).toContain('sweep().catch(() => {})')
  })
})

describe('Settings Danger Zone: gated on owner role, destructive action requires typed confirmation', () => {
  const src = read('app/(dashboard)/settings/page.tsx')

  it('DangerZoneSection only renders the delete UI for the owner', () => {
    const idx = src.indexOf('function DangerZoneSection')
    const body = src.slice(idx, src.indexOf('\nfunction ', idx + 10))
    expect(body).toContain("role === 'owner'")
    expect(body).toContain('if (!isOwner) {')
  })

  it('the confirm button stays disabled until the typed name exactly matches', () => {
    const idx = src.indexOf('function DeleteAccountModal')
    const body = src.slice(idx, src.indexOf('\nfunction ', idx + 10))
    expect(body).toContain('confirmName.trim() !== orgName')
  })

  it('a Danger Zone tab exists in the settings nav', () => {
    expect(src).toContain("{ id: 'danger',    label: 'Danger Zone' }")
  })
})
