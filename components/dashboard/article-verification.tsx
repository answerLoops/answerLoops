'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { verifyArticleAction, type VerifyArticleState } from '@/lib/actions/kb'
import { VERIFICATION_NOTE_MAX } from '@/lib/kb/verification-limits'
import type { ArticleVerification } from '@/types'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function lastChecked(v: ArticleVerification): string {
  const when = v.verified_at ? formatDate(v.verified_at) : ''
  return v.verified_by_name ? `${when} by ${v.verified_by_name}` : when
}

/**
 * Where an article stands, always in words: the icon is decoration, so the state
 * is never carried by color alone.
 */
function StatusLine({ verification }: { verification: ArticleVerification }) {
  if (verification.status === 'verified') {
    return (
      <p className="min-w-0 break-words text-xs text-emerald-700">
        <span aria-hidden="true">✓ </span>
        Verified {lastChecked(verification)}
      </p>
    )
  }
  if (verification.status === 'changed') {
    return (
      <p className="min-w-0 break-words text-xs text-amber-700">
        <span aria-hidden="true">! </span>
        Changed since last verified ({lastChecked(verification)})
      </p>
    )
  }
  return <p className="min-w-0 break-words text-xs text-slate-500">Never verified</p>
}

/**
 * The verification status of one article, and the control to record that a
 * person has checked it. Verifying stores who and when, plus the article's text
 * at that moment, so a later edit makes the status read "changed" until someone
 * verifies again. The note is optional (for example the product version checked).
 */
export function ArticleVerificationControl({
  articleId,
  verification,
  onVerified,
}: {
  articleId: number
  verification: ArticleVerification
  onVerified?: () => void
}) {
  const [open, setOpen] = useState(false)
  // Controlled, because React resets an uncontrolled form after every action,
  // including a failed one, which would throw away what the person just typed.
  const [note, setNote] = useState('')

  const [state, formAction, pending] = useActionState(
    async (prev: VerifyArticleState, formData: FormData): Promise<VerifyArticleState> => {
      const result = await verifyArticleAction(prev, formData)
      if (result && 'ok' in result) {
        setOpen(false)
        setNote('')
        onVerified?.()
      }
      return result
    },
    null
  )

  const noteId = `verify-note-${articleId}`

  return (
    <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <StatusLine verification={verification} />
        </div>
        {!open && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {verification.status === 'verified' ? 'Verify again' : 'Mark as verified'}
          </Button>
        )}
      </div>

      {verification.note && (
        <p className="break-words text-xs text-slate-600">
          <span className="font-medium">Note:</span> {verification.note}
        </p>
      )}

      {open && (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="articleId" value={articleId} />
          <label htmlFor={noteId} className="block text-xs font-medium text-slate-700">
            Note (optional)
          </label>
          <textarea
            id={noteId}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={VERIFICATION_NOTE_MAX}
            rows={2}
            placeholder="For example, the product version you checked it against"
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Mark as verified'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpen(false)
                setNote('')
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            {state && 'error' in state && (
              <p role="alert" className="min-w-0 break-words text-xs text-red-600">
                {state.error}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
