'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { KBSource } from '@/types'
import { runKbSync, pollKbSyncJob, type KbSyncJobStatus } from '@/lib/kb/sync-client'

interface NotionKbState {
  conn: { connection?: { workspace_name?: string | null; kb_last_synced?: string | null; kb_chunk_count?: number | null } | null }
  sources: unknown
}

async function fetchNotionKbState(): Promise<NotionKbState> {
  const [conn, sources] = await Promise.all([
    fetch('/api/notion').then((r) => (r.ok ? r.json() : { connection: null })).catch(() => ({ connection: null })),
    fetch('/api/kb/sources').then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ])
  return { conn, sources }
}

export function NotionKBSection({ onSynced }: { onSynced: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [source, setSource] = useState<KBSource | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncLabel, setSyncLabel] = useState<string>('Syncing…')
  const [syncElapsed, setSyncElapsed] = useState(0)
  const [togglingPublish, setTogglingPublish] = useState(false)
  const [confirmingPublish, setConfirmingPublish] = useState(false)
  const confirmPanelRef = useRef<HTMLFieldSetElement>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    if (!syncing) return
    const t = setInterval(() => setSyncElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [syncing])

  // While the publish prompt is open: put focus on Cancel (the safe choice) and
  // let Escape dismiss it. Listening on the document rather than the panel keeps
  // Escape working wherever focus has moved to.
  useEffect(() => {
    if (!confirmingPublish) return
    confirmPanelRef.current?.querySelector('button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmingPublish(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmingPublish])

  const applyState = useCallback((state: NotionKbState) => {
    setConnected(!!state.conn.connection)
    setWorkspace(state.conn.connection?.workspace_name ?? null)
    setLastSynced(state.conn.connection?.kb_last_synced ?? null)
    setChunkCount(state.conn.connection?.kb_chunk_count ?? 0)
    setSource((state.sources as KBSource[]).find((s) => s.file_type === 'notion') ?? null)
  }, [])

  const loadState = useCallback(async () => {
    applyState(await fetchNotionKbState())
  }, [applyState])

  useEffect(() => {
    let cancelled = false
    fetchNotionKbState().then((state) => {
      if (!cancelled) applyState(state)
    })
    return () => { cancelled = true }
  }, [applyState])

  const onSyncedRef = useRef(onSynced)
  useEffect(() => { onSyncedRef.current = onSynced })

  // Stops an in-flight poll on unmount — checked by pollKbSyncJob before
  // every request. The `cancelled` flag below only gated the state updates
  // after a poll resolved, not the poll loop itself, so navigating away
  // mid-sync left it running in the background indefinitely.
  const stoppedRef = useRef(false)
  useEffect(() => () => { stoppedRef.current = true }, [])

  // Resume the progress display if a sync is already in flight (e.g. the user
  // navigated away and came back, or the GitHub push webhook queued one).
  // Mount-only — the refs keep the latest callbacks without re-running.
  useEffect(() => {
    let cancelled = false
    fetch('/api/kb/sync-jobs?kind=notion')
      .then((r) => (r.ok ? r.json() : null))
      .then((job: KbSyncJobStatus | null) => {
        if (cancelled || !job || (job.status !== 'queued' && job.status !== 'running')) return
        stoppedRef.current = false
        setSyncing(true)
        setSyncElapsed(0)
        setSyncLabel(job.status === 'running' ? 'Syncing…' : 'Queued…')
        pollKbSyncJob('/api/kb/sync-jobs?kind=notion', setSyncLabel, () => stoppedRef.current).then((result) => {
          if (cancelled) return
          setToast(result.detail)
          if (result.ok) { loadState(); onSyncedRef.current() }
          setSyncing(false)
          setTimeout(() => setToast(null), 5000)
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [loadState])

  const sync = async () => {
    stoppedRef.current = false
    setSyncing(true)
    setSyncElapsed(0)
    setTruncated(false)
    setSyncLabel('Queued…')
    const result = await runKbSync('/api/notion/sync-kb', '/api/kb/sync-jobs?kind=notion', setSyncLabel, () => stoppedRef.current)
    if (result.ok) {
      setToast(result.detail)
      setTruncated(/cap was hit|wasn.t imported/i.test(result.detail))
      await loadState()
      onSynced()
    } else {
      setToast(result.detail)
    }
    setSyncing(false)
    setTimeout(() => setToast(null), 5000)
  }

  const setPublished = async (next: 0 | 1) => {
    if (!source) return
    setConfirmingPublish(false)
    setTogglingPublish(true)
    try {
      const res = await fetch(`/api/kb/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: next }),
      })
      if (res.ok) {
        await loadState()
        onSynced()
      } else {
        setToast('Could not update publish state')
      }
    } finally {
      setTogglingPublish(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  // Taking the content off the widget is always safe, so it happens at once.
  // Putting it on the widget asks first: the import covers everything the
  // Notion integration can see, not a page the person picked.
  const onPublishButton = () => {
    if (!source) return
    if (source.published === 1) setPublished(0)
    else setConfirmingPublish(true)
  }

  if (connected === null) return null // still loading

  if (connected === false) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Notion workspace</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Keep your support docs in Notion? Connect a workspace and sync its pages and databases into the knowledge base.{' '}
          <Link href="/integrations?tab=notion" className="text-brand-600 hover:underline">Connect Notion →</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Notion workspace</h2>
        <p className="text-xs text-gray-500 mt-0.5 break-words">
          {workspace ? `Connected to ${workspace}. ` : ''}Pages and databases shared with your integration are synced into the knowledge base.{' '}
          <Link href="/integrations?tab=notion" className="text-brand-600 hover:underline">Manage in Integrations →</Link>
        </p>
      </div>

      {toast && <p className="text-xs text-green-600">{toast}</p>}
      {truncated && (
        <p className="text-xs text-amber-600">Knowledge base is full — some Notion content wasn&apos;t imported.</p>
      )}
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">
            {chunkCount > 0
              ? `${chunkCount} chunk${chunkCount === 1 ? '' : 's'} · last synced ${lastSynced ? new Date(lastSynced).toLocaleDateString() : 'never'}`
              : 'Not yet synced'}
          </p>
          {source && (
            <p className={`text-xs ${source.published === 1 ? 'text-green-600' : 'text-amber-600'}`}>
              {source.published === 1 ? 'Live on the website widget' : 'Not visible to the website widget'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={sync} disabled={syncing} className="flex items-center gap-1.5">
            {syncing && (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onPublishButton}
            disabled={!source || togglingPublish || confirmingPublish}
            title={!source ? 'Run a sync first' : undefined}
          >
            {togglingPublish ? '…' : source?.published === 1 ? 'Unpublish' : 'Publish to widget'}
          </Button>
        </div>
      </div>

      {confirmingPublish && (
        <fieldset
          ref={confirmPanelRef}
          aria-label="Confirm publishing to the website widget"
          className="min-w-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 space-y-2"
        >
          <p className="text-sm font-medium text-amber-900">Publish to your website widget?</p>
          <p className="text-xs text-amber-800 break-words">
            {chunkCount > 0 ? `${chunkCount} chunk${chunkCount === 1 ? '' : 's'} will go live. ` : ''}
            Every page and database shared with your Notion integration becomes available to answer anyone who
            uses your widget. Check which pages are shared in Notion before you publish.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmingPublish(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setPublished(1)} disabled={togglingPublish}>
              Yes, publish
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  )
}
