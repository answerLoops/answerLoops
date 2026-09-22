import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real bug found live: an invite sent to nathan@answerloops.com was opened
// in a browser that already had a valid session for a completely different
// account (owner@example.com, the org's own owner testing the
// flow). The invite page never checked whether the signed-in email matched
// the invite's target email — it just showed "Signed in as
// owner@example.com" and let that account accept, silently
// consuming the invite under the wrong identity and permanently locking
// out the actual invited email (accepted_at set, so the real recipient's
// click on the same link would show "invalid or already used").
//
// Fixed with the check in two places: the page renders an explicit
// mismatch screen before ever showing the Accept button (so this is caught
// immediately, not after a submit round-trip), and acceptInviteAction
// re-checks the same thing server-side as defense-in-depth against a
// direct POST to a stale-cached page.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('lib/actions/invitations.ts — acceptInviteAction blocks a mismatched email', () => {
  const src = read('lib/actions/invitations.ts')

  it('compares session.user.email against invite.email case-insensitively before any acceptance logic', () => {
    const checkIdx = src.indexOf("session.user.email?.toLowerCase() !== invite.email.toLowerCase()")
    const isMemberIdx = src.indexOf('if (await isMember(userId, invite.org_id))')
    const addMemberIdx = src.indexOf('await addMember(userId, invite.org_id, invite.role)')
    expect(checkIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(isMemberIdx)
    expect(checkIdx).toBeLessThan(addMemberIdx)
  })

  it('redirects to the email_mismatch error with the invited email, never silently proceeding', () => {
    expect(src).toContain("redirect(`/invite/${token}?error=email_mismatch&email=${encodeURIComponent(invite.email)}`)")
  })
})

describe('app/invite/[token]/page.tsx — shows the mismatch screen before the Accept button', () => {
  const src = read('app/invite/[token]/page.tsx')

  it('checks the email match before rendering the accept form, not just relying on the server action', () => {
    const checkIdx = src.indexOf("session.user.email?.toLowerCase() !== invite.email.toLowerCase()")
    const formIdx = src.indexOf('acceptInviteAction.bind(null, token)')
    expect(checkIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(formIdx)
  })

  it('handles the email_mismatch query param from the server-action redirect too', () => {
    expect(src).toContain("error === 'email_mismatch'")
  })

  it('offers a sign-out-and-switch-accounts path that returns to the same invite', () => {
    expect(src).toContain('logoutAndReturnTo')
    expect(src).toContain('`/invite/${token}`')
  })
})

describe('lib/actions/auth.ts — logoutAndReturnTo', () => {
  const src = read('lib/actions/auth.ts')

  it('only allows same-origin relative redirect targets, guarding against open redirect', () => {
    const fnIdx = src.indexOf('export async function logoutAndReturnTo(')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain("callbackUrl.startsWith('/')")
    expect(fnBody).toContain("!callbackUrl.startsWith('//')")
  })
})

const {
  redirect: redirect2,
  acceptInvitation: acceptInvitation2,
  addMember: addMember2,
  isMember: isMember2,
  getInvitationByToken: getInvitationByToken2,
  auth: auth2,
  unstable_update: unstableUpdate2,
} = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
  acceptInvitation: vi.fn(async () => undefined),
  addMember: vi.fn(async () => undefined),
  isMember: vi.fn(async () => false),
  getInvitationByToken: vi.fn(async () => ({
    id: 1,
    org_id: 1,
    email: 'invitee@example.com',
    role: 'member',
    token: 'tok',
    invited_by: 1,
    expires_at: '2099-01-01T00:00:00.000Z',
    accepted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
  })),
  auth: vi.fn(async () => ({ user: { id: '5', email: 'someone-else@example.com' }, orgId: 1 })),
  unstable_update: vi.fn(async () => undefined),
}))

vi.mock('next/navigation', () => ({ redirect: redirect2 }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/auth', () => ({ auth: auth2, unstable_update: unstableUpdate2 }))
vi.mock('@/lib/db/queries/invitations', () => ({
  createInvitation: vi.fn(),
  getInvitationByToken: getInvitationByToken2,
  acceptInvitation: acceptInvitation2,
  revokeInvitation: vi.fn(),
}))
vi.mock('@/lib/db/queries/members', () => ({ addMember: addMember2, isMember: isMember2 }))

describe('acceptInviteAction — behavioral: mismatched email is rejected before any DB write', () => {
  const redirect = redirect2
  const acceptInvitation = acceptInvitation2
  const addMember = addMember2
  const isMember = isMember2
  const auth = auth2

  beforeEach(() => {
    vi.clearAllMocks()
    redirect.mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) })
    isMember.mockResolvedValue(false)
    auth.mockResolvedValue({ user: { id: '5', email: 'someone-else@example.com' }, orgId: 1 })
  })

  it('redirects to email_mismatch and never calls acceptInvitation or addMember', async () => {
    const { acceptInviteAction } = await import('@/lib/actions/invitations')

    await expect(acceptInviteAction('tok')).rejects.toThrow(
      'NEXT_REDIRECT:/invite/tok?error=email_mismatch&email=invitee%40example.com'
    )

    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(addMember).not.toHaveBeenCalled()
  })

  it('proceeds normally when the signed-in email matches, case-insensitively', async () => {
    auth.mockResolvedValue({ user: { id: '5', email: 'INVITEE@EXAMPLE.COM' }, orgId: 1 })
    const { acceptInviteAction } = await import('@/lib/actions/invitations')

    await expect(acceptInviteAction('tok')).rejects.toThrow('NEXT_REDIRECT:/dashboard')

    expect(acceptInvitation).toHaveBeenCalledWith('tok')
    expect(addMember).toHaveBeenCalled()
  })
})
