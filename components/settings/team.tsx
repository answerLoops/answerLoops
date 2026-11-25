'use client'

import { useActionState, useRef, useState, useEffect } from 'react'
import { sendInviteAction, revokeInviteAction, removeMemberAction, transferOwnershipAction } from '@/lib/actions/invitations'
import { Button } from '@/components/ui/button'
import { subscribeLiveEvents } from '@/lib/live-events'

export interface Member {
  membership_id: number
  user_id: number
  role: string
  joined_at: string
  email: string | null
  name: string | null
}

interface PendingInvite {
  id: number
  email: string
  role: string
  expires_at: string
  token: string
}



function TransferOwnershipModal({
  target,
  onConfirm,
  onCancel,
  pending,
}: {
  target: Member
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 mx-4">
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Transfer Ownership</h2>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          You are about to transfer ownership of this workspace to{' '}
          <span className="font-medium text-gray-900">{target.name ?? target.email}</span>.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          You will become a regular member and lose owner privileges. This cannot be undone unless the new owner transfers it back.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 transition-colors"
          >
            {pending ? 'Transferring…' : 'Yes, transfer ownership'}
          </button>
        </div>
      </div>
    </div>
  )
}


async function fetchTeam(): Promise<{ members: Member[]; invites: PendingInvite[] }> {
  const [members, invites] = await Promise.all([
    fetch('/api/team/members').then((r) => r.json()),
    fetch('/api/team/invites').then((r) => r.json()),
  ])
  return { members, invites }
}

export function TeamSection() {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [transferTarget, setTransferTarget] = useState<Member | null>(null)
  const [transferPending, setTransferPending] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session').then((r) => r.json()).then((s) => {
      if (s?.user?.id) setCurrentUserId(Number(s.user.id))
    })
  }, [])

  const [inviteCopied, setInviteCopied] = useState(false)

  const reload = async () => {
    const team = await fetchTeam()
    setMembers(team.members)
    setInvites(team.invites)
  }

  const [inviteState, inviteFormAction, invitePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await sendInviteAction(prev, fd)
      if (!result?.error && result?.inviteUrl) {
        await navigator.clipboard.writeText(result.inviteUrl).catch(() => {})
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 4000)
        await reload()
      }
      return result
    },
    null
  )

  useEffect(() => {
    let cancelled = false
    fetchTeam().then((team) => {
      if (cancelled) return
      setMembers(team.members)
      setInvites(team.invites)
    })
    return () => { cancelled = true }
  }, [])

  // Live-update when a team member accepts an invite — no polling needed.
  // This rides the tab's shared SSE stream rather than opening a second one:
  // the dashboard layout already mounts DashboardLive, and each stream costs
  // a dedicated Postgres LISTEN connection. `resync` means the stream was
  // rebuilt (tab refocused, or the connection went stale) and a
  // member_joined may have been missed while it was down — the member and
  // invite lists are client state that a router.refresh() would not
  // repopulate, so refetch them here.
  useEffect(() => subscribeLiveEvents(['member_joined', 'resync'], () => { reload() }), [])

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Current members */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold text-gray-600">Members</p>
        </div>
        {members.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No members yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => {
              const isCurrentUser = m.user_id === currentUserId
              const isOwner = m.role === 'owner'
              const viewerIsOwner = members.find((x) => x.user_id === currentUserId)?.role === 'owner'
              const hasOtherMembers = members.length > 1

              return (
                <li key={m.membership_id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{m.name ?? m.email ?? 'Unknown'}</p>
                    <p className="text-xs text-gray-400">{m.email} · <span className="capitalize">{m.role}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    {viewerIsOwner && !isCurrentUser && !isOwner && hasOtherMembers && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-brand-600 hover:text-brand-800"
                        onClick={() => setTransferTarget(m)}
                      >
                        Transfer Ownership
                      </Button>
                    )}
                    {!isOwner && (
                      <form action={async (fd) => { await removeMemberAction(null, fd); await reload() }}>
                        <input type="hidden" name="membershipId" value={m.membership_id} />
                        <input type="hidden" name="userId" value={m.user_id} />
                        <Button type="submit" size="sm" variant="ghost">Remove</Button>
                      </form>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-600">Pending Invites</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{inv.email}</p>
                  <p className="text-xs text-gray-400">
                    <span className="capitalize">{inv.role}</span> · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => copyLink(inv.token)}
                  >
                    {copiedToken === inv.token ? 'Copied!' : 'Copy link'}
                  </Button>
                  <form action={async (fd) => { await revokeInviteAction(null, fd); await reload() }}>
                    <input type="hidden" name="id" value={inv.id} />
                    <Button type="submit" size="sm" variant="ghost">Revoke</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Invite form */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">Invite a teammate</p>
        <form action={inviteFormAction} className="flex gap-2 flex-wrap">
          <input
            name="email"
            type="email"
            placeholder="colleague@example.com"
            required
            className="flex-1 min-w-0 rounded border border-gray-200 px-3 py-1.5 text-sm"
          />
          <select name="role" className="rounded border border-gray-200 px-2 py-1.5 text-sm bg-white">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" size="sm" disabled={invitePending}>
            {invitePending ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
        {(inviteState as { error?: string } | null)?.error && (
          <p className="mt-2 text-xs text-red-600">{(inviteState as { error?: string }).error}</p>
        )}
        {inviteCopied && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <svg className="h-4 w-4 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <p className="text-xs text-green-700 font-medium">Invite link copied to clipboard — send it to your teammate.</p>
          </div>
        )}
      </div>

      {transferTarget && (
        <TransferOwnershipModal
          target={transferTarget}
          pending={transferPending}
          onCancel={() => setTransferTarget(null)}
          onConfirm={async () => {
            setTransferPending(true)
            const fd = new FormData()
            fd.set('membershipId', String(transferTarget.membership_id))
            fd.set('userId', String(transferTarget.user_id))
            await transferOwnershipAction(null, fd)
            setTransferPending(false)
            setTransferTarget(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}
