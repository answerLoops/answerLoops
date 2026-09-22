'use client'

import { useState, useEffect, useCallback, useRef, useActionState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveNotionConnectionAction, deleteNotionConnectionAction } from '@/lib/actions/notion'
import { runKbSync, pollKbSyncJob, type KbSyncJobStatus } from '@/lib/kb/sync-client'
import type { NotionConnection } from '@/types'
import { Button } from '@/components/ui/button'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'

export function NotionIntegrationCard() {
  const [connection, setConnection] = useState<NotionConnection | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncLabel, setSyncLabel] = useState('Sync now')
  const [syncElapsed, setSyncElapsed] = useState(0)
  const { toastMessage, toastKind, showToast } = useToast()
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast
  // Stops any in-flight sync poll — set on unmount and on a successful
  // Disconnect, checked by pollKbSyncJob before every request. Without this,
  // disconnecting mid-sync left the poll loop running forever in the
  // background (same component instance, so unmount alone never fired):
  // the card would show "Not connected" while still hammering
  // /api/kb/sync-jobs every 2.5s until the page was reloaded.
  const stoppedRef = useRef(false)
  useEffect(() => () => { stoppedRef.current = true }, [])
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    if (!syncing) { setSyncElapsed(0); return }
    const t = setInterval(() => setSyncElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [syncing])

  const reload = useCallback(async () => {
    const data = await fetch('/api/notion').then((r) => r.json()).catch(() => ({ connection: null }))
    setConnection(data.connection ?? null)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Resume the progress display if a sync is already in flight — e.g. the
  // user started it from the Knowledge Base page, or is just revisiting this
  // tab while one runs in the background. Without this, this card has no
  // way to know a sync is happening until it finishes, even though the
  // Knowledge Base page (which polls independently) shows it live.
  useEffect(() => {
    let cancelled = false
    fetch('/api/kb/sync-jobs?kind=notion')
      .then((r) => (r.ok ? r.json() : null))
      .then((job: KbSyncJobStatus | null) => {
        if (cancelled || !job || (job.status !== 'queued' && job.status !== 'running')) return
        stoppedRef.current = false
        setSyncing(true)
        setSyncLabel(job.status === 'running' ? 'Syncing…' : 'Queued…')
        pollKbSyncJob('/api/kb/sync-jobs?kind=notion', setSyncLabel, () => stoppedRef.current).then((result) => {
          if (cancelled) return
          showToastRef.current(result.detail, result.ok ? 'success' : 'error')
          if (result.ok) reload()
          setSyncing(false)
          setSyncLabel('Sync now')
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [reload])

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveNotionConnectionAction(prev, fd)
      if (!result?.error) {
        await reload()
        setEditing(false)
        showToast('Notion connected')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteNotionConnectionAction(prev, fd)
      if (!result?.error) { stoppedRef.current = true; setConnection(null); setEditing(false); setSyncing(false) }
      return result
    },
    null
  )

  async function handleSync() {
    stoppedRef.current = false
    setSyncing(true)
    setSyncLabel('Queued…')
    try {
      const result = await runKbSync('/api/notion/sync-kb', '/api/kb/sync-jobs?kind=notion', setSyncLabel, () => stoppedRef.current)
      showToast(result.detail, result.ok ? 'success' : 'error')
      if (result.ok) await reload()
    } finally {
      setSyncing(false)
      setSyncLabel('Sync now')
    }
  }

  if (connection === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = connection !== null
  const showForm = !connected || editing

  return (
    <>
      {toastMessage && <Toast message={toastMessage} kind={toastKind} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-full bg-neutral-900 flex items-center justify-center text-white text-sm font-bold">N</div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Notion</p>
              <p className="text-xs text-gray-500 truncate">
                {connected
                  ? `Connected${connection.workspace_name ? ` · ${connection.workspace_name}` : ''}`
                  : 'Not connected'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {connected ? 'Active' : 'Inactive'}
            </span>
            {connected && !editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Replace token
              </Button>
            )}
          </div>
        </div>

        {connected && !editing && (
          <>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
              <ReadOnlyRow label="Workspace" value={connection.workspace_name ?? '—'} />
              <ReadOnlyRow label="Token" value="••••••••• (saved)" />
              <ReadOnlyRow label="Last synced" value={connection.kb_last_synced ? new Date(connection.kb_last_synced).toLocaleString() : 'Never'} />
              <ReadOnlyRow label="Chunks" value={String(connection.kb_chunk_count)} />
            </div>
            <div className="rounded-md bg-neutral-50 border border-neutral-200 p-3 space-y-2">
              <p className="text-xs text-neutral-600">
                Share the Notion pages and databases you want synced with your connection, then run a sync. Imported content stays unpublished until you publish it on the Knowledge Base page.
              </p>
              {syncing && (
                <div className="flex items-center gap-2.5 rounded-md border border-brand-100 bg-brand-50 px-3 py-2">
                  <svg className="h-3.5 w-3.5 animate-spin text-brand-500 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-xs text-brand-700 truncate min-w-0">{syncLabel}</span>
                  <span className="text-xs text-brand-400 tabular-nums ml-auto shrink-0">{syncElapsed}s</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={syncing} onClick={handleSync} className="flex items-center gap-1.5">
                  {syncing && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  )}
                  {syncing ? 'Syncing…' : 'Sync now'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={deletePending}
                  onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
                >
                  {deletePending ? 'Removing…' : 'Disconnect'}
                </Button>
              </div>
            </div>
          </>
        )}

        {showForm && (
          <form key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notion access token</label>
              <input
                name="token"
                type="password"
                autoComplete="new-password"
                placeholder={connected ? '••••••••• (leave blank to keep current)' : 'ntn_… or secret_…'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                In Notion: <span className="font-medium">Settings → Developer → Open developer tools</span> → <span className="font-medium">+ New connection</span> → choose <span className="font-medium">Access token</span> → copy the token it gives you. Then share one parent page with the connection (<span className="font-medium">•••  → Connections</span>, add it) — its subpages sync automatically. answerLoops syncs everything the connection can see.
              </p>
            </div>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : connected ? 'Update' : 'Connect'}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}

        {(deleteState as { error?: string } | null)?.error && (
          <p className="text-xs text-red-600">{(deleteState as { error?: string }).error}</p>
        )}
      </div>
    </>
  )
}

