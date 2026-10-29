import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The per-request org gate (`resolveOrgAccess`, wired into auth.ts's
 * `authorized` callback).
 *
 * Two things can revoke access after a token has been issued: the org being
 * soft-deleted, and the user's membership being removed. Neither can reach a
 * JWT that already exists, and the token is re-signed with a fresh expiry on
 * every session read, so anything cached in the session keeps granting access
 * indefinitely while the person keeps using the app. Deletion was already
 * resolved live; membership was not — so removing a member did not end their
 * access to the org.
 *
 * These tests drive the resolver against a fake driver and assert on the
 * decision it returns, plus the shape of the single query it issues.
 */

const { calls, orgRow } = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  orgRow: { value: [] as unknown[][] },
}))

const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  return { rows: orgRow.value }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

const mod = () => import('@/lib/auth/membership')

// Column order matches the select in resolveOrgAccess: onboardedAt, deletedAt,
// membershipId, termsAcceptedAt. pg-proxy returns positional rows.
const row = (
  onboardedAt: string | null,
  deletedAt: string | null,
  membershipId: number | null,
  termsAcceptedAt: string | null = '2026-01-01T00:00:00.000Z',
) => [[onboardedAt, deletedAt, membershipId, termsAcceptedAt]]

beforeEach(() => {
  calls.length = 0
  orgRow.value = []
})

describe('resolveOrgAccess: membership is required on every request', () => {
  it('reports not-member when the membership row is gone', async () => {
    const { resolveOrgAccess } = await mod()
    // The org still exists and is healthy — only the membership was removed.
    orgRow.value = row('2026-01-01', null, null)

    expect(await resolveOrgAccess(5, 42)).toEqual({ status: 'not-member' })
  })

  it('reports ok while the membership exists', async () => {
    const { resolveOrgAccess } = await mod()
    orgRow.value = row('2026-01-01', null, 900)

    expect(await resolveOrgAccess(5, 42)).toMatchObject({ status: 'ok', onboardedAt: '2026-01-01' })
  })

  it('reports org-missing when the org row does not exist', async () => {
    const { resolveOrgAccess } = await mod()
    orgRow.value = []

    expect(await resolveOrgAccess(5, 42)).toEqual({ status: 'org-missing' })
  })

  it('reports org-deleted for a member of a soft-deleted org', async () => {
    // Must stay distinguishable from not-member: this user is still an owner and
    // needs to reach the restore flow, which a sign-out would deny them.
    const { resolveOrgAccess } = await mod()
    orgRow.value = row('2026-01-01', '2026-08-01', 900)

    expect(await resolveOrgAccess(5, 42)).toEqual({ status: 'org-deleted' })
  })

  it('prefers not-member over org-deleted when both apply', async () => {
    // Someone removed from an org has no claim on it in any state, including a
    // restore. Getting this backwards would show a former member the
    // account-deleted page for an org they no longer belong to.
    const { resolveOrgAccess } = await mod()
    orgRow.value = row('2026-01-01', '2026-08-01', null)

    expect(await resolveOrgAccess(5, 42)).toEqual({ status: 'not-member' })
  })
})

describe('resolveOrgAccess: an unscopeable session is rejected, never defaulted', () => {
  it.each([
    ['no orgId at all', 5, undefined],
    ['a null orgId', 5, null],
    ['a non-numeric orgId', 5, 'abc'],
    ['a zero orgId', 5, 0],
    ['no userId', undefined, 42],
    ['a non-numeric userId', 'abc', 42],
  ])('rejects %s as invalid-session', async (_label, userId, orgId) => {
    const { resolveOrgAccess } = await mod()
    orgRow.value = row('2026-01-01', null, 900) // a healthy row is available

    expect(await resolveOrgAccess(userId, orgId)).toEqual({ status: 'invalid-session' })
    // And critically, it must not have gone looking for a fallback org.
    expect(calls, 'a query was issued for an unscopeable session').toHaveLength(0)
  })
})

describe('resolveOrgAccess: the query itself', () => {
  it('joins membership rather than issuing a second round trip', async () => {
    const { resolveOrgAccess } = await mod()
    orgRow.value = row(null, null, 900)

    await resolveOrgAccess(5, 42)

    // Runs on every non-public request, so a second query here is a real cost.
    expect(calls).toHaveLength(1)
    const sql = calls[0].sql.toLowerCase()
    expect(sql).toContain('left join')
    expect(sql).toContain('memberships')
    expect(calls[0].params).toEqual(expect.arrayContaining([5, 42]))
  })

  it('scopes the join to both the user and the org', async () => {
    const { resolveOrgAccess } = await mod()
    orgRow.value = row(null, null, 900)

    await resolveOrgAccess(5, 42)

    const sql = calls[0].sql.toLowerCase()
    // Either half alone is a hole: user-only would match a membership in some
    // other org, org-only would match some other user's membership.
    expect(sql).toContain('"user_id" =')
    expect(sql).toContain('"org_id" =')
  })
})

describe('auth.ts routes each outcome to the right response', () => {
  const src = () => fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')

  it('no longer substitutes a default org in the request gate', () => {
    // The regression this replaces: the gate resolved `orgId ?? DEFAULT_ORG_ID`,
    // so a session with no org claim was checked — and then served — as org 1.
    // Absence property, so a source scan is the right tool.
    const s = src().replace(/\/\/.*$/gm, '')
    const gate = s.slice(s.indexOf('async authorized('), s.indexOf('async jwt('))
    expect(gate).not.toContain('DEFAULT_ORG_ID')
  })

  it('signs out rather than downgrading when the session cannot be scoped', () => {
    const s = src()
    const gate = s.slice(s.indexOf('async authorized('), s.indexOf('async jwt('))
    for (const status of ['invalid-session', 'org-missing', 'not-member']) {
      expect(gate, `${status} is not handled in the request gate`).toContain(status)
    }
    expect(gate).toContain('/api/auth/signout')
  })

  it('keeps the account-deleted page reachable so a restore is still possible', () => {
    const s = src()
    const gate = s.slice(s.indexOf('async authorized('), s.indexOf('async jwt('))
    // The whole check is skipped on that path; without the exemption a deleted
    // org's owner could never reach the action that undoes the deletion.
    expect(gate).toContain('pathname !== ACCOUNT_DELETED_PATH')
  })
})
