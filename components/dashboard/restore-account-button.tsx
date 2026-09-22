'use client'

import { useActionState } from 'react'
import { restoreAccountAction } from '@/app/actions/account'

export function RestoreAccountButton() {
  const [state, formAction, pending] = useActionState(
    async () => await restoreAccountAction(),
    null
  )

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-all"
      >
        {pending ? 'Restoring…' : 'Restore my account'}
      </button>
      {(state as { error?: string } | null)?.error && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 text-center">
          {(state as { error?: string }).error}
        </p>
      )}
    </form>
  )
}
