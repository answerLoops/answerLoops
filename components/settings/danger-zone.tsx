'use client'

import { useRef, useState, useEffect } from 'react'
import { deleteAccountAction, getCurrentOrgName } from '@/lib/actions/account'
import { Button } from '@/components/ui/button'
import type { Member } from '@/components/settings/team'

function DeleteAccountModal({
  orgName,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  orgName: string
  onConfirm: (confirmName: string) => void
  onCancel: () => void
  pending: boolean
  error?: string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [confirmName, setConfirmName] = useState('')

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 mx-4">
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg className="h-5 w-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Delete workspace</h2>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          This cancels billing and revokes access immediately. Your data (tickets, knowledge base,
          integrations, API keys) is kept for 30 days in case this was a mistake, then permanently deleted.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          Type <span className="font-semibold text-gray-900">{orgName}</span> to confirm.
        </p>
        <input
          type="text"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={orgName}
          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-red-400 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <button
            onClick={() => onConfirm(confirmName)}
            disabled={pending || confirmName.trim() !== orgName}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DangerZoneSection() {
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [orgName, setOrgName] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    fetch('/api/auth/session').then((r) => r.json()).then((s) => {
      if (s?.user?.id) setCurrentUserId(Number(s.user.id))
    })
    fetch('/api/team/members').then((r) => r.json()).then(setMembers).catch(() => {})
    getCurrentOrgName().then(setOrgName)
  }, [])

  const isOwner = members.find((m) => m.user_id === currentUserId)?.role === 'owner'

  async function handleConfirm(confirmName: string) {
    setPending(true)
    setError(undefined)
    const fd = new FormData()
    fd.set('confirmName', confirmName)
    const result = await deleteAccountAction(null, fd)
    if (result?.error) {
      setError(result.error)
      setPending(false)
      return
    }
    // deleteAccountAction signs the user out and redirects on success —
    // if we're still here, the browser will follow shortly.
  }

  if (!isOwner) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm text-gray-500">Only the workspace owner can delete this account.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-red-200 p-5">
      <p className="text-sm font-medium text-gray-900">Delete this workspace</p>
      <p className="text-xs text-gray-500 mt-1 max-w-lg">
        Permanently deletes {orgName ?? 'this workspace'} — billing, integrations, tickets, and knowledge
        base. Access is revoked immediately; data is kept for 30 days in case you change your mind.
      </p>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
      >
        Delete workspace…
      </button>

      {showModal && orgName && (
        <DeleteAccountModal
          orgName={orgName}
          pending={pending}
          error={error}
          onCancel={() => { setShowModal(false); setError(undefined) }}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}
