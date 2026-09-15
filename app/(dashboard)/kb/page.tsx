'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { KBArticle, KBSearchResult, KBSource, GitHubRepo } from '@/types'
import { ingestUrlAction } from '@/app/actions/ingest-url'
import type { IngestUrlResult } from '@/app/actions/ingest-url'
import { runKbSync, pollKbSyncJob, type KbSyncJobStatus } from '@/lib/kb/sync-client'

type Article = KBArticle | KBSearchResult

function hasScore(a: Article): a is KBSearchResult {
  return 'score' in a
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTypeIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    pdf: 'text-red-500',
    docx: 'text-blue-500',
    md: 'text-gray-600',
    txt: 'text-gray-500',
    csv: 'text-green-600',
    github: 'text-gray-800',
    'github-discussion': 'text-gray-800',
    notion: 'text-neutral-800',
  }
  return (
    <span className={`text-xs font-bold uppercase tabular-nums ${colors[type] ?? 'text-gray-500'}`}>
      {type}
    </span>
  )
}

function SourcesList({ onDeleted }: { onDeleted: () => void }) {
  const [sources, setSources] = useState<KBSource[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)

  async function load() {
    const res = await fetch('/api/kb/sources')
    if (res.ok) {
      const data = (await res.json()) as KBSource[]
      setSources(data)
      setSelected(new Set())
    }
  }

  useEffect(() => { load() }, [])

  const allChecked = sources.length > 0 && selected.size === sources.length
  const someChecked = selected.size > 0

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(sources.map(s => s.id)))
  }

  function toggleOne(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDeleteSelected() {
    setBulkDeleting(true)
    await Promise.all([...selected].map(id => fetch(`/api/kb/sources/${id}`, { method: 'DELETE' })))
    setBulkDeleting(false)
    setConfirmBulk(false)
    await load()
    onDeleted()
  }

  if (sources.length === 0) return null

  const selectedChunks = sources.filter(s => selected.has(s.id)).reduce((n, s) => n + s.chunk_count, 0)

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600 cursor-pointer"
          />
          <h2 className="text-sm font-semibold text-gray-900">
            Sources {someChecked && <span className="font-normal text-gray-500">({selected.size} selected)</span>}
          </h2>
        </div>
        {someChecked && (
          confirmBulk ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">Delete {selectedChunks} chunks?</span>
              <Button size="sm" onClick={handleDeleteSelected} disabled={bulkDeleting} className="bg-red-600 hover:bg-red-700 text-white">
                {bulkDeleting ? 'Deleting…' : 'Confirm'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmBulk(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirmBulk(true)} className="bg-red-600 hover:bg-red-700 text-white">
              Delete selected
            </Button>
          )
        )}
      </div>
      <ul className="divide-y divide-gray-100">
        {sources.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggleOne(s.id)}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600 cursor-pointer shrink-0"
            />
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FileTypeIcon type={s.file_type} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {s.file_type === 'notion' ? 'Notion workspace' : s.filename}
                  </p>
                  {s.published === 0 && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-700">Unpublished</span>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  {s.chunk_count} chunk{s.chunk_count !== 1 ? 's' : ''} · {formatBytes(s.size_bytes)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GitHubKBSection({ onSynced }: { onSynced: () => void }) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncLabel, setSyncLabel] = useState<string>('Syncing…')
  const [toast, setToast] = useState<string | null>(null)

  const loadRepos = useCallback(() => {
    fetch('/api/github/repos')
      .then((r) => r.ok ? r.json() : [])
      .then((all: GitHubRepo[]) => setRepos(all.filter((r) => r.kb_enabled === 1)))
      .catch(() => setRepos([]))
  }, [])

  useEffect(() => { loadRepos() }, [loadRepos])

  const stoppedRef = useRef(false)
  useEffect(() => () => { stoppedRef.current = true }, [])

  const sync = async (repo: GitHubRepo) => {
    stoppedRef.current = false
    setSyncingId(repo.id)
    setSyncLabel('Queued…')
    const result = await runKbSync(
      `/api/github/sync-kb?repo_id=${repo.id}`,
      `/api/kb/sync-jobs?kind=github_repo&repo_id=${repo.id}`,
      setSyncLabel,
      () => stoppedRef.current,
    )
    if (result.ok) {
      setToast(`${repo.owner}/${repo.repo}: ${result.detail}`)
      onSynced()
      loadRepos()
    } else {
      setToast(`${repo.owner}/${repo.repo}: ${result.detail}`)
    }
    setSyncingId(null)
    setTimeout(() => setToast(null), 5000)
  }

  if (repos.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">GitHub Repositories</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Markdown files from these repos are synced into the knowledge base.{' '}
          <Link href="/integrations?tab=github" className="text-brand-600 hover:underline">Manage in Integrations →</Link>
        </p>
      </div>

      {toast && (
        <p className="text-xs text-green-600">{toast}</p>
      )}

      <ul className="space-y-2">
        {repos.map((repo) => (
          <li key={repo.id} className="flex flex-wrap items-center justify-between bg-white rounded-md border border-gray-200 px-3 py-2.5 gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 font-mono break-all">{repo.owner}/{repo.repo}</p>
              <p className="text-xs text-gray-400">
                {repo.kb_chunk_count > 0
                  ? `${repo.kb_chunk_count} chunks · last synced ${repo.kb_last_synced ? new Date(repo.kb_last_synced).toLocaleDateString() : 'never'}`
                  : 'Not yet synced'}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => sync(repo)}
              disabled={syncingId === repo.id}
            >
              {syncingId === repo.id ? syncLabel : 'Sync now'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
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
  const [toast, setToast] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    if (!syncing) { setSyncElapsed(0); return }
    const t = setInterval(() => setSyncElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [syncing])

  const loadState = useCallback(async () => {
    const [conn, sources] = await Promise.all([
      fetch('/api/notion').then((r) => (r.ok ? r.json() : { connection: null })).catch(() => ({ connection: null })),
      fetch('/api/kb/sources').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
    setConnected(!!conn.connection)
    setWorkspace(conn.connection?.workspace_name ?? null)
    setLastSynced(conn.connection?.kb_last_synced ?? null)
    setChunkCount(conn.connection?.kb_chunk_count ?? 0)
    setSource((sources as KBSource[]).find((s) => s.file_type === 'notion') ?? null)
  }, [])

  useEffect(() => { loadState() }, [loadState])

  const onSyncedRef = useRef(onSynced)
  onSyncedRef.current = onSynced

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

  const togglePublish = async () => {
    if (!source) return
    const next = source.published === 1 ? 0 : 1
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
            onClick={togglePublish}
            disabled={!source || togglingPublish}
            title={!source ? 'Run a sync first' : undefined}
          >
            {togglingPublish ? '…' : source?.published === 1 ? 'Unpublish' : 'Publish to widget'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function FileUploadSection({ onImported }: { onImported: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ error?: string; created?: number; filename?: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/kb/upload', { method: 'POST', body: fd })
      const data = await res.json() as { error?: string; created?: number; filename?: string }
      setResult(data)
      if (!data.error) onImported()
    } catch {
      setResult({ error: 'Upload failed. Try again.' })
    } finally {
      setUploading(false)
    }
  }, [onImported])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) upload(file)
    e.target.value = ''
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Upload file</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          PDF, DOCX, MD, TXT, CSV — up to 50 MB. Each file is chunked and embedded into the knowledge base.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`
          flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors
          ${dragging ? 'border-brand-400 bg-brand-50' : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/30'}
          ${uploading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.md,.txt,.csv"
          className="hidden"
          onChange={onFileChange}
        />
        {uploading ? (
          <>
            <svg className="h-6 w-6 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p className="text-sm text-brand-700 font-medium">Parsing and embedding…</p>
            <p className="text-xs text-brand-500">This can take 15–60 seconds for large files.</p>
          </>
        ) : (
          <>
            <svg className="h-6 w-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 16V8m0 0l-3 3m3-3l3 3M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-brand-600">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-400">PDF · DOCX · MD · TXT · CSV</p>
          </>
        )}
      </div>

      {result?.error && (
        <p className="text-xs text-red-500">{result.error}</p>
      )}
      {result?.created != null && !result.error && (
        <p className={`text-xs ${result.created === 0 ? 'text-red-600' : 'text-green-600'}`}>
          {result.created === 0
            ? `No chunks extracted from ${result.filename} — the file may be empty, unreadable, or too short to embed.`
            : `Ingested ${result.created} chunk${result.created !== 1 ? 's' : ''} from ${result.filename}.`}
        </p>
      )}
    </div>
  )
}

const INGEST_PHASES = [
  { after: 0,   msg: 'Fetching content…',               sub: 'Reading the page.' },
  { after: 5,   msg: 'Scanning pages…',                 sub: 'Collecting content from each page.' },
  { after: 20,  msg: 'Analyzing content…',              sub: 'Breaking content into searchable chunks.' },
  { after: 45,  msg: 'Adding to knowledge base…',       sub: 'Saving articles so your AI can find them.' },
  { after: 75,  msg: 'Almost there…',                   sub: 'Large sites can take up to 2 minutes.' },
  { after: 110, msg: 'Still importing…',                sub: 'Nearly done.' },
]

function useIngestProgress(pending: boolean) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!pending) { setElapsed(0); return }
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [pending])
  const phase = [...INGEST_PHASES].reverse().find(p => elapsed >= p.after) ?? INGEST_PHASES[0]
  return { elapsed, phase }
}

function UrlIngestSection({ onImported }: { onImported: () => void }) {
  const [result, action, pending] = useActionState<IngestUrlResult, FormData>(
    async (prev, fd) => {
      try {
        const r = await ingestUrlAction(prev, fd)
        if (!r.error) onImported()
        return r
      } catch {
        // Network timeout or connection dropped — import may have completed server-side
        onImported()
        return { error: 'Connection timed out. Your import may have completed — check the articles list below.' }
      }
    },
    {}
  )
  const [mode, setMode] = useState<'page' | 'site'>('page')
  const { elapsed, phase } = useIngestProgress(pending)

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Import from URL</h2>
        <p className="text-xs text-gray-500 mt-0.5">Crawl a page or entire site and add the content to the knowledge base.</p>
      </div>

      <form action={action} className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
            <input type="radio" name="mode" value="page" checked={mode === 'page'} onChange={() => setMode('page')} />
            Single page
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
            <input type="radio" name="mode" value="site" checked={mode === 'site'} onChange={() => setMode('site')} />
            Entire site <span className="text-gray-400">(up to 25 pages)</span>
          </label>
        </div>

        <div className="flex gap-2">
          <input
            name="url"
            type="url"
            required
            disabled={pending}
            placeholder="https://docs.example.com"
            className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-50"
          />
          <Button type="submit" size="sm" disabled={pending} className="flex items-center gap-1.5 min-w-[90px] justify-center">
            {pending && (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {pending ? 'Importing…' : 'Import'}
          </Button>
        </div>

        {pending && (
          <div className="flex items-start gap-2.5 rounded-md border border-brand-100 bg-brand-50 px-3 py-2.5">
            <svg className="h-4 w-4 animate-spin text-brand-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-brand-700">{phase.msg}</p>
                <span className="text-xs text-brand-400 tabular-nums shrink-0">{elapsed}s</span>
              </div>
              <p className="text-xs text-brand-500 mt-0.5">{phase.sub}</p>
            </div>
          </div>
        )}

        {result.error && (
          <p className="text-xs text-red-500">{result.error}</p>
        )}
        {result.created != null && !result.error && (
          <p className={`text-xs ${
            result.created === 0 ? 'text-red-600' : result.incomplete ? 'text-amber-600' : 'text-green-600'
          }`}>
            {result.pages != null
              ? result.pages === 0 && !result.skipped
                ? `No pages found at this URL — check that the site is publicly reachable (not behind a login/waitlist, and not blocked by robots.txt).`
                : `Imported ${result.created} articles from ${result.pages}${result.pagesFound ? ` of ${result.pagesFound}` : ''} pages${result.skipped ? ` (${result.skipped} already in KB, skipped)` : ''}.`
              : `Imported ${result.created} articles${result.skipped ? ` (${result.skipped} already in KB, skipped)` : ''}.`}
            {result.incomplete && ' Import was interrupted partway through — click Import again to pick up the remaining pages.'}
            {!result.incomplete && result.remaining ? ` ${result.remaining} more page${result.remaining !== 1 ? 's' : ''} found — click Import again to continue.` : ''}
          </p>
        )}
      </form>
    </div>
  )
}

function ArticlesList({ articles, onDeleted }: { articles: (Article | KBSearchResult)[]; onDeleted: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)

  const allChecked = articles.length > 0 && selected.size === articles.length
  const someChecked = selected.size > 0

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(articles.map(a => a.id)))
  }

  function toggleOne(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDeleteSelected() {
    setBulkDeleting(true)
    await Promise.all([...selected].map(id => fetch(`/api/kb/articles/${id}`, { method: 'DELETE' })))
    setBulkDeleting(false)
    setConfirmBulk(false)
    setSelected(new Set())
    onDeleted()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600"
          />
          <span className="text-xs text-gray-500">
            {someChecked ? `${selected.size} of ${articles.length} selected` : `${articles.length} article${articles.length !== 1 ? 's' : ''}`}
          </span>
        </label>
        {someChecked && (
          confirmBulk ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">Delete {selected.size} article{selected.size !== 1 ? 's' : ''}?</span>
              <Button size="sm" onClick={handleDeleteSelected} disabled={bulkDeleting} className="bg-red-600 hover:bg-red-700 text-white">
                {bulkDeleting ? 'Deleting…' : 'Confirm'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmBulk(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirmBulk(true)} className="bg-red-600 hover:bg-red-700 text-white">
              Delete selected
            </Button>
          )
        )}
      </div>
      <ul className="space-y-2">
        {articles.map((a) => (
          <li key={a.id} className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 p-4">
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              onChange={() => toggleOne(a.id)}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600 shrink-0 mt-1 cursor-pointer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-sm font-semibold text-gray-900 min-w-0 break-words">{a.question}</h2>
                {hasScore(a) && (
                  <span className="shrink-0 text-xs text-gray-400">{(a.score * 100).toFixed(0)}% match</span>
                )}
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.answer}</p>
              {a.source_ticket_number != null && (
                <Link href={`/tickets/${a.source_ticket_number}`} className="mt-2 inline-block text-xs text-brand-600 hover:underline">
                  From ticket #{a.source_ticket_number} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function KBPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sourcesKey, setSourcesKey] = useState(0)

  async function loadAll() {
    setLoading(true)
    try {
      const res = await fetch('/api/kb')
      const data = await res.json()
      setArticles(Array.isArray(data) ? (data as KBArticle[]) : [])
    } finally {
      setLoading(false)
    }
  }

  function refreshSources() {
    setSourcesKey((k) => k + 1)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchDegraded, setSearchDegraded] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return loadAll()
    setSearching(true)
    setSearchError(null)
    setSearchDegraded(false)
    try {
      const res = await fetch(`/api/kb/search?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { results?: KBSearchResult[]; degraded?: boolean; error?: string }
      if (!res.ok || data.error) {
        setSearchError(data.error ?? 'Search failed')
        setArticles([])
      } else {
        setArticles(data.results ?? [])
        setSearchDegraded(data.degraded ?? false)
      }
    } catch {
      setSearchError('Search failed — check your AI config and API key.')
      setArticles([])
    } finally {
      setSearching(false)
    }
  }

  function clear() {
    setQuery('')
    setSearchError(null)
    setSearchDegraded(false)
    loadAll()
  }

  return (
    <div className="dashboard-page max-w-6xl space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-blue-600">
          <span className="h-px w-6 bg-blue-500" />
          Answer intelligence
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Knowledge Base</h1>
        <p className="mt-1 text-sm text-slate-500">Give every channel one current, searchable source of truth.</p>
      </div>

      <GitHubKBSection onSynced={loadAll} />
      <NotionKBSection onSynced={() => { loadAll(); refreshSources() }} />
      <FileUploadSection onImported={() => { loadAll(); refreshSources() }} />
      <UrlIngestSection onImported={loadAll} />
      <SourcesList key={sourcesKey} onDeleted={() => { loadAll(); refreshSources() }} />

      <form onSubmit={search} className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm">
        <div className="relative w-full sm:flex-1 sm:w-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the knowledge base…"
            className="w-full rounded-md border border-gray-200 px-3 py-2 pr-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
        {query && (
          <Button type="button" size="sm" variant="secondary" onClick={clear}>
            Clear
          </Button>
        )}
      </form>

      {searchError && (
        <p className="text-xs text-red-500">{searchError}</p>
      )}
      {searchDegraded && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <svg className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div>
            <p className="text-xs font-medium text-amber-800">Keyword search only — semantic search unavailable</p>
            <p className="text-xs text-amber-700 mt-0.5">
              AI embedding failed (invalid or missing API key). Results are exact text matches only, not natural language.{' '}
              <a href="/settings" className="underline font-medium">Fix in Settings →</a>
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : articles.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No articles yet. Upload a file, import from a URL, or promote a resolved ticket from its detail page.
        </p>
      ) : (
        <ArticlesList articles={articles} onDeleted={loadAll} />
      )}
    </div>
  )
}
