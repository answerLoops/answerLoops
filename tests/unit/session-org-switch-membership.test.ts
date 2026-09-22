import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Tenant-isolation guardrail for the Auth.js session-update path.
 *
 * The `orgId` claim on the JWT scopes every org query in the application, and
 * the session-update payload it can be set from is caller-supplied. So a
 * requested org is only adopted when the user has a real membership row for it.
 *
 * These tests assert that behaviourally — including that the membership query
 * is actually issued and is scoped to both the user and the requested org —
 * rather than asserting on the shape of the implementation. Rationale for the
 * change is on the internal security page; it is deliberately not restated
 * here, since this repository is public.
 */

const { calls, membershipRows } = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  membershipRows: { value: [] as unknown[][] },
}))

const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  if (sql.includes('memberships')) return { rows: membershipRows.value }
  return { rows: [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

const mod = () => import('@/lib/auth/membership')

beforeEach(() => {
  calls.length = 0
  membershipRows.value = []
})

describe('resolveOrgIdForSessionUpdate: a switch requires real membership', () => {
  it('refuses an org the user has no membership row for', async () => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    membershipRows.value = [] // not a member of org 999

    const result = await resolveOrgIdForSessionUpdate(5, 999)

    // null means "leave the existing claim alone" — the switch is a no-op.
    expect(result).toBeNull()
  })

  it('allows an org the user is a member of', async () => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    membershipRows.value = [[42]] // membership row exists

    const result = await resolveOrgIdForSessionUpdate(5, 42)

    expect(result).toBe(42)
  })

  it('checks membership for the requested org, scoped to the requesting user', async () => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    membershipRows.value = [[42]]

    await resolveOrgIdForSessionUpdate(5, 42)

    const q = calls.find((c) => c.sql.includes('memberships'))
    expect(q, 'no membership query was issued — the org id was taken on trust').toBeDefined()
    // Both halves matter: user alone would let any member of any org switch
    // anywhere, org alone would let a non-member in.
    expect(q!.sql.toLowerCase()).toContain('"user_id" =')
    expect(q!.sql.toLowerCase()).toContain('"org_id" =')
    expect(q!.params).toEqual(expect.arrayContaining([5, 42]))
  })

  it('does not query at all when no orgId was requested', async () => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    const result = await resolveOrgIdForSessionUpdate(5, undefined)
    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['a non-numeric org id', 'not-a-number'],
    ['zero', 0],
    ['a negative id', -1],
    ['a float', 1.5],
    ['null', null],
  ])('rejects %s without honouring it', async (_label, requested) => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    membershipRows.value = [[1]] // even with a row present, the shape must fail first
    const result = await resolveOrgIdForSessionUpdate(5, requested)
    expect(result).toBeNull()
  })

  it('rejects when the user id itself is missing or malformed', async () => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    membershipRows.value = [[42]]
    // A token without a userId claim must not be able to switch orgs, even to
    // an org that happens to have a membership row for someone.
    expect(await resolveOrgIdForSessionUpdate(undefined, 42)).toBeNull()
    expect(await resolveOrgIdForSessionUpdate('abc', 42)).toBeNull()
  })
})

describe('auth.ts wires the check into the jwt update branch', () => {
  const src = () => fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')

  it('never assigns token.orgId directly from the update payload', () => {
    // An absence property — the one case a source scan is the right tool for,
    // since there is no behaviour to invoke, only a shape that must not come
    // back. Comments are stripped so a comment mentioning the pattern doesn't
    // trip it.
    const s = src().replace(/\/\/.*$/gm, '')
    expect(s).not.toMatch(/token\.orgId\s*=\s*data\.orgId/)
  })

  it('routes the update through the membership-checked resolver', () => {
    expect(src()).toContain('resolveOrgIdForSessionUpdate')
  })
})

describe('the real consumer of this path keeps working', () => {
  // Accepting an invitation is the one place in the app that legitimately
  // changes the org claim (lib/actions/invitations.ts). It is allowed only
  // because it creates the membership row *before* asking for the switch — so
  // that ordering is load-bearing, and nothing else enforces it. Reversing it
  // would leave the invitee pointed at the personal org the same action just
  // deleted, and the live org check in auth.ts would then sign them out.
  const inviteSrc = () =>
    fs.readFileSync(path.join(process.cwd(), 'lib/actions/invitations.ts'), 'utf-8')

  it('adds the membership before requesting the org switch', () => {
    const s = inviteSrc()
    const addMemberAt = s.indexOf('addMember(userId, invite.org_id')
    const updateAt = s.indexOf('unstable_update({ orgId')
    expect(addMemberAt, 'addMember call not found — has it been renamed?').toBeGreaterThan(-1)
    expect(updateAt, 'unstable_update call not found — has it been renamed?').toBeGreaterThan(-1)
    expect(
      addMemberAt,
      'the org switch now happens before the membership row is created, so the ' +
        'membership check will reject it and invitees will be signed out instead ' +
        'of landing in the org they just joined',
    ).toBeLessThan(updateAt)
  })

  it('permits the switch once the membership exists', async () => {
    const { resolveOrgIdForSessionUpdate } = await mod()
    membershipRows.value = [[77]] // addMember has run
    expect(await resolveOrgIdForSessionUpdate(5, 77)).toBe(77)
  })

  it('leaves an onboarding-style update, which carries no orgId, untouched', async () => {
    // lib/actions/onboarding.ts calls unstable_update({ onboarded: true }).
    // That must not be affected by, or incur the cost of, the membership check.
    const { resolveOrgIdForSessionUpdate } = await mod()
    expect(await resolveOrgIdForSessionUpdate(5, undefined)).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
