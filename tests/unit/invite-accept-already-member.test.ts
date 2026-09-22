import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real bug found live: an invite sent, then followed by someone already a
// member of the target org (re-clicking an old link, testing the flow as
// the org's own owner) left the invitation permanently stuck in Pending
// Invites — accepted_at stayed null and no membership row ever explained
// why, because acceptInviteAction's "already a member" branch redirected
// straight to /dashboard without ever calling acceptInvitation(token).
// Confirmed against the real dev database: the invitation row's
// accepted_at was still null and no matching membership existed, even
// though the invite flow had visibly completed from the user's side.
//
// Fixed by consuming the invitation in that branch too, and by adding a
// second Postgres trigger (lib/db/migrate.ts, notify_invite_accepted) so
// the inviter's Settings page still gets a live member_joined SSE push in
// this path — the existing trigger only fires on a memberships INSERT,
// which doesn't happen here since no new membership is created.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const { redirect, acceptInvitation, addMember, isMember, getInvitationByToken, auth, unstable_update } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
  acceptInvitation: vi.fn(async () => undefined),
  addMember: vi.fn(async () => undefined),
  isMember: vi.fn(async () => true),
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
  auth: vi.fn(async () => ({ user: { id: '5', email: 'invitee@example.com' }, orgId: 1 })),
  unstable_update: vi.fn(async () => undefined),
}))

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/auth', () => ({ auth, unstable_update }))
vi.mock('@/lib/db/queries/invitations', () => ({
  createInvitation: vi.fn(),
  getInvitationByToken,
  acceptInvitation,
  revokeInvitation: vi.fn(),
}))
vi.mock('@/lib/db/queries/members', () => ({ addMember, isMember }))

describe('lib/actions/invitations.ts — already-a-member branch consumes the invitation', () => {
  const src = read('lib/actions/invitations.ts')

  it('calls acceptInvitation(token) before redirecting when the user is already a member', () => {
    const branchIdx = src.indexOf('if (await isMember(userId, invite.org_id)) {')
    expect(branchIdx).toBeGreaterThan(-1)
    const branchEnd = src.indexOf('}', branchIdx)
    const branchBody = src.slice(branchIdx, branchEnd)
    const acceptIdx = branchBody.indexOf('acceptInvitation(token)')
    const redirectIdx = branchBody.indexOf("redirect('/dashboard')")
    expect(acceptIdx).toBeGreaterThan(-1)
    expect(redirectIdx).toBeGreaterThan(-1)
    expect(acceptIdx).toBeLessThan(redirectIdx)
  })
})

describe('lib/db/migrate.ts — invitation acceptance without a new membership still notifies live', () => {
  const src = read('lib/db/migrate.ts')

  it('adds a trigger on invitations that fires member_joined only when accepted_at transitions from null', () => {
    const fnIdx = src.indexOf('CREATE OR REPLACE FUNCTION notify_invite_accepted()')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnBody = src.slice(fnIdx, src.indexOf('$$;', fnIdx))
    expect(fnBody).toContain('NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL')
    expect(fnBody).toContain("pg_notify('member_joined', NEW.org_id::text)")
  })

  it('registers the trigger AFTER UPDATE on invitations, dropping any stale copy first', () => {
    expect(src).toContain('DROP TRIGGER IF EXISTS trg_invite_accepted ON invitations')
    expect(src).toContain('AFTER UPDATE ON invitations')
    expect(src).toContain('FOR EACH ROW EXECUTE FUNCTION notify_invite_accepted()')
  })
})

describe('acceptInviteAction — behavioral: execution order when already a member', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redirect.mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) })
    isMember.mockResolvedValue(true)
  })

  it('calls acceptInvitation but not addMember when the user is already a member, then redirects', async () => {
    const { acceptInviteAction } = await import('@/lib/actions/invitations')

    await expect(acceptInviteAction('tok')).rejects.toThrow('NEXT_REDIRECT:/dashboard')

    expect(acceptInvitation).toHaveBeenCalledWith('tok')
    expect(addMember).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })
})
