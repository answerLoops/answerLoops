'use client'

import { useActionState, useState } from 'react'
import { updateAIDraftAction } from '@/lib/actions/tickets'
import { Button } from '@/components/ui/button'
import type { AIDraftStatus } from '@/types'

interface AIDraftPanelProps {
  ticketId: number
  draft: string
  status: AIDraftStatus
  sourcePlatform?: string
}

const PLATFORM_NAME: Record<string, string> = {
  github: 'GitHub', slack: 'Slack', telegram: 'Telegram', email: 'email', discord: 'Discord', mcp: 'the requesting agent', discourse: 'Discourse', circle: 'Circle',
}

export function AIDraftPanel({ ticketId, draft, status, sourcePlatform = 'discord' }: AIDraftPanelProps) {
  const platformName = PLATFORM_NAME[sourcePlatform] ?? 'Discord'
  const [state, formAction, isPending] = useActionState(updateAIDraftAction, null)
  const [editing, setEditing] = useState(false)
  const [editedDraft, setEditedDraft] = useState(draft)
  const [copied, setCopied] = useState(false)

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(editing ? editedDraft : draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — user can still select the text */
    }
  }

  if (status === 'overridden') return null

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-brand-200">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          <span className="text-xs font-semibold text-brand-700">AI Draft Answer</span>
          {status === 'posted' && (
            <span className="text-xs text-brand-500">Posted to {platformName} — awaiting review</span>
          )}
          {status === 'approved' && (
            <span className="text-xs text-green-600 font-medium">Approved</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={copyDraft}>
            {copied ? 'Copied' : 'Copy draft'}
          </Button>
          {status !== 'approved' && (
          <>
            <form action={formAction}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <input type="hidden" name="action" value="approve" />
              <Button type="submit" size="sm" variant="secondary" disabled={isPending}>Approve</Button>
            </form>
            <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
            <form action={formAction}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <input type="hidden" name="action" value="override" />
              <Button type="submit" size="sm" variant="ghost" disabled={isPending}
                className="text-gray-400 hover:text-red-500">
                Dismiss
              </Button>
            </form>
          </>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {editing ? (
          <form action={formAction} className="space-y-2">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="action" value="edit" />
            <textarea
              name="newDraft"
              value={editedDraft}
              onChange={(e) => setEditedDraft(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-brand-200 bg-white px-3 py-2 text-sm resize-none font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? 'Saving…' : `Save & post to ${platformName}`}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <pre className="whitespace-pre-wrap text-xs text-gray-700 font-sans leading-relaxed">{draft}</pre>
        )}
        {state?.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      </div>
    </div>
  )
}
