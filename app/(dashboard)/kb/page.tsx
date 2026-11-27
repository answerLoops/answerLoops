'use client'

import { RepoSyncStatus } from '@/components/kb/repo-sync-status'
import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { KBArticle, KBSearchResult, KBSource, GitHubRepo } from '@/types'
import { describeAge, isResolution, sortBySaved, type ArticleSortOrder } from '@/lib/kb/resolution-age'
import { ingestUrlAction } from '@/lib/actions/ingest-url'
import type { IngestUrlResult } from '@/lib/actions/ingest-url'
import { runKbSync } from '@/lib/kb/sync-client'
import { NotionKBSection } from '@/components/dashboard/notion-kb-section'
import { AddKnowledgeSection, type KnowledgeDraft } from '@/components/dashboard/add-knowledge-section'
import { WRITE_ANSWER_INTRO } from '@/components/dashboard/write-answer-copy'
import { getTicketDraftAction } from '@/lib/actions/kb'
import { CoverageTab } from './coverage-tab'
import { ArticleAnswers } from '@/components/dashboard/article-answers'
import { ArticleHistory } from '@/components/dashboard/article-history'
import { ArticleVerificationControl } from '@/components/dashboard/article-verification'
import { ArticleReviewStateControl, type ReplacementOption } from '@/components/dashboard/article-review-state'
import { ReviewTab } from './review-tab'
import { FlagsTab } from './flags-tab'
import { GapsTab } from './gaps-tab'
import type { ReviewCounts } from '@/lib/db/queries/kb-review'
import type { FlagCounts } from '@/lib/db/queries/widget-answer-flags'
import { Page, PageHeader } from '@/components/dashboard/page-shell'

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

async function fetchKbSources(): Promise<KBSource[] | null> {
  const res = await fetch('/api/kb/sources')
  return res.ok ? ((await res.json()) as KBSource[]) : null
}

const DELETE_FORBIDDEN_MESSAGE = 'Only workspace owners and admins can delete knowledge base content.'

interface BulkDeleteResult {
  deletedIds: number[]
  failedIds: number[]
  forbidden: boolean
}

/** Deletes each id and reports which ones the server actually removed. */
async function deleteEach(basePath: string, ids: number[]): Promise<BulkDeleteResult> {
  const outcomes = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`${basePath}/${id}`, { method: 'DELETE' })
        return { id, ok: res.ok, status: res.status }
      } catch {
        return { id, ok: false, status: 0 }
      }
    })
  )
  return {
    deletedIds: outcomes.filter((o) => o.ok).map((o) => o.id),
    failedIds: outcomes.filter((o) => !o.ok).map((o) => o.id),
    forbidden: outcomes.some((o) => o.status === 403),
  }
}

function deleteErrorMessage(result: BulkDeleteResult, noun: string): string {
  const total = result.deletedIds.length + result.failedIds.length
  const partial =
    result.deletedIds.length > 0
      ? `Deleted ${result.deletedIds.length} of ${total} ${noun}${total !== 1 ? 's' : ''}. `
      : ''
  const reason = result.forbidden
    ? DELETE_FORBIDDEN_MESSAGE
    : `Could not delete ${result.failedIds.length === 1 ? 'one' : result.failedIds.length} ${noun}${result.failedIds.length !== 1 ? 's' : ''}. Try again.`
  return partial + reason
}

function DeleteError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      {message}
    </p>
  )
}

/** GitHub repos that feed the knowledge base, with a way to re-sync each one. */
function useGitHubSync(onSynced: () => void) {
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
    setToast(`${repo.owner}/${repo.repo}: ${result.detail}`)
    if (result.ok) {
      onSynced()
      loadRepos()
    }
    setSyncingId(null)
    setTimeout(() => setToast(null), 5000)
  }

  return { repos, syncingId, syncLabel, toast, sync }
}

type GitHubSync = ReturnType<typeof useGitHubSync>

const SOURCE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'urls', label: 'URLs' },
  { id: 'github', label: 'GitHub' },
  { id: 'notion', label: 'Notion' },
] as const
type SourceFilterId = (typeof SOURCE_FILTERS)[number]['id']

function sourceGroup(fileType: string): Exclude<SourceFilterId, 'all'> {
  if (fileType === 'url') return 'urls'
  if (fileType === 'notion') return 'notion'
  if (fileType === 'github' || fileType === 'github-discussion') return 'github'
  return 'files'
}

function SourcesList({
  onDeleted,
  onLoaded,
  github,
}: {
  onDeleted: () => void
  onLoaded: (sources: KBSource[]) => void
  github: GitHubSync
}) {
  const [sources, setSources] = useState<KBSource[]>([])
  const [filter, setFilter] = useState<SourceFilterId>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded })

  async function load() {
    const data = await fetchKbSources()
    if (data) {
      setSources(data)
      setSelected(new Set())
      onLoadedRef.current(data)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchKbSources().then((data) => {
      if (cancelled || !data) return
      setSources(data)
      setSelected(new Set())
      onLoadedRef.current(data)
    })
    return () => { cancelled = true }
  }, [])

  const visible = filter === 'all' ? sources : sources.filter((s) => sourceGroup(s.file_type) === filter)
  const allChecked = visible.length > 0 && visible.every((s) => selected.has(s.id))
  const someChecked = selected.size > 0

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(visible.map((s) => s.id)))
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
    setDeleteError(null)
    const result = await deleteEach('/api/kb/sources', [...selected])
    setBulkDeleting(false)
    setConfirmBulk(false)
    if (result.deletedIds.length > 0) {
      // Reload so the list shows what is really left, then keep only the
      // sources that failed selected so they can be retried.
      await load()
      onDeleted()
    }
    if (result.failedIds.length > 0) {
      setSelected(new Set(result.failedIds))
      setDeleteError(deleteErrorMessage(result, 'source'))
    }
  }

  if (sources.length === 0) return null

  const selectedChunks = sources.filter(s => selected.has(s.id)).reduce((n, s) => n + s.chunk_count, 0)
  const presentGroups = new Set(sources.map((s) => sourceGroup(s.file_type)))
  const filters = SOURCE_FILTERS.filter((f) => f.id === 'all' || presentGroups.has(f.id))

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            aria-label="Select all sources"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600 cursor-pointer"
          />
          <h2 className="text-sm font-semibold text-gray-900">
            Sources {someChecked && <span className="font-normal text-gray-500">({selected.size} selected)</span>}
          </h2>
        </div>
        {someChecked ? (
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
        ) : (
          filters.length > 2 && (
            <div className="flex gap-1" role="group" aria-label="Filter sources">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={[
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    filter === f.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>
      {deleteError && <div className="px-4 pt-3"><DeleteError message={deleteError} /></div>}
      {github.toast && <p role="status" className="px-4 pt-3 text-xs text-green-600">{github.toast}</p>}
      <ul className="divide-y divide-gray-100">
        {visible.map((s) => {
          const repo = s.file_type === 'github' ? github.repos.find((r) => `${r.owner}/${r.repo}` === s.filename) : undefined
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                aria-label={`Select ${s.filename}`}
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
                    {repo ? (
                      <RepoSyncStatus repo={repo} />
                    ) : (
                      <>{s.chunk_count} chunk{s.chunk_count !== 1 ? 's' : ''} · {formatBytes(s.size_bytes)}</>
                    )}
                  </p>
                </div>
              </div>
              {repo && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => github.sync(repo)}
                  disabled={github.syncingId === repo.id}
                >
                  {github.syncingId === repo.id ? github.syncLabel : 'Sync now'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Tells the person how many imported sections were left out because their exact text is already in the knowledge base. */
function duplicatesNote(duplicates: number | undefined): string {
  return duplicates ? ` ${duplicates} section${duplicates !== 1 ? 's were' : ' was'} already in your knowledge base, so ${duplicates !== 1 ? 'they were' : 'it was'} not added again.` : ''
}

function FileUploadSection({ onImported }: { onImported: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ error?: string; created?: number; duplicates?: number; filename?: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/kb/upload', { method: 'POST', body: fd })
      const data = await res.json() as { error?: string; created?: number; duplicates?: number; filename?: string }
      setResult(data)
      // A partial upload still added sections, so refresh the list for those too.
      if (!data.error || data.created) onImported()
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
    <div className="space-y-3">
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
        <p className="break-words text-xs text-red-500">{result.error}</p>
      )}
      {result?.created != null && !result.error && (
        <p className={`break-words text-xs ${result.created === 0 ? 'text-red-600' : 'text-green-600'}`}>
          {result.created === 0
            ? `No chunks extracted from ${result.filename} — the file may be empty, unreadable, or too short to embed.`
            : `Ingested ${result.created} chunk${result.created !== 1 ? 's' : ''} from ${result.filename}.${duplicatesNote(result.duplicates)}`}
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
    if (!pending) return
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => {
      clearInterval(t)
      setElapsed(0)
    }
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
    <div className="space-y-3">
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
          <p className="break-words text-xs text-red-500">{result.error}</p>
        )}
        {result.created != null && !result.error && (
          <p className={`break-words text-xs ${
            result.created === 0 && !result.duplicates ? 'text-red-600' : result.incomplete ? 'text-amber-600' : 'text-green-600'
          }`}>
            {result.pages != null
              ? result.pages === 0 && !result.skipped
                ? `No pages found at this URL — check that the site is publicly reachable (not behind a login/waitlist, and not blocked by robots.txt).`
                : `Imported ${result.created} articles from ${result.pages}${result.pagesFound ? ` of ${result.pagesFound}` : ''} pages${result.skipped ? ` (${result.skipped} already in KB, skipped)` : ''}.${duplicatesNote(result.duplicates)}`
              : `Imported ${result.created} articles${result.skipped ? ` (${result.skipped} already in KB, skipped)` : ''}.${duplicatesNote(result.duplicates)}`}
            {result.incomplete && ' Import was interrupted partway through — click Import again to pick up the remaining pages.'}
            {!result.incomplete && result.remaining ? ` ${result.remaining} more page${result.remaining !== 1 ? 's' : ''} found — click Import again to continue.` : ''}
          </p>
        )}
      </form>
    </div>
  )
}

// When a saved resolution was last saved, so reviewers can spot the ones old
// enough to be worth re-checking.
function ResolutionSavedLine({ updatedAt }: { updatedAt: string }) {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return null
  const age = describeAge(updatedAt)
  return (
    <p className="mt-1 text-xs text-gray-500">
      Saved <time dateTime={updatedAt}>{date.toLocaleDateString()}</time>
      {age && <> · {age}</>}
    </p>
  )
}

// Shown on a saved resolution while documentation related to it has changed
// since it was last saved or verified. Verifying it again, or saving it again,
// clears the notice.
function RelatedDocsNotice({ change }: { change: { at: string; source: string } }) {
  const date = new Date(change.at)
  if (Number.isNaN(date.getTime())) return null
  return (
    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 break-words">
      Docs related to this answer changed after it was saved ({change.source},{' '}
      <time dateTime={change.at}>{date.toLocaleDateString()}</time>). Check it still holds, then use{' '}
      <span className="font-medium">Verify again</span> to clear this.
    </p>
  )
}

function ArticlesList({
  articles,
  replacementPool,
  onDeleted,
  onVerified,
}: {
  articles: (Article | KBSearchResult)[]
  /** Every listed article that could replace another: not superseded. */
  replacementPool: ReplacementOption[]
  onDeleted: () => void
  onVerified: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const allChecked = articles.length > 0 && selected.size === articles.length
  const someChecked = selected.size > 0

  // A link such as /kb#article-12 (from the sources shown on a ticket) lands on
  // that article. The list loads after the page does, so scroll once it is here.
  useEffect(() => {
    if (articles.length === 0) return
    const match = window.location.hash.match(/^#article-(\d+)$/)
    if (!match) return
    const el = document.getElementById(`article-${match[1]}`)
    el?.scrollIntoView({ block: 'center' })
    el?.focus({ preventScroll: true })
  }, [articles])

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
    setDeleteError(null)
    const result = await deleteEach('/api/kb/articles', [...selected])
    setBulkDeleting(false)
    setConfirmBulk(false)
    // Keep only the articles that failed selected so they can be retried.
    setSelected(new Set(result.failedIds))
    if (result.failedIds.length > 0) setDeleteError(deleteErrorMessage(result, 'article'))
    if (result.deletedIds.length > 0) onDeleted()
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
      <DeleteError message={deleteError} />
      <ul className="space-y-2">
        {articles.map((a) => (
          <li
            key={a.id}
            id={`article-${a.id}`}
            tabIndex={-1}
            className="flex scroll-mt-20 items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 outline-none target:ring-2 target:ring-brand-300"
          >
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
              {isResolution(a) && <ResolutionSavedLine updatedAt={a.updated_at} />}
              {a.related_docs_changed && <RelatedDocsNotice change={a.related_docs_changed} />}
              {a.verification && (
                <ArticleVerificationControl articleId={a.id} verification={a.verification} onVerified={onVerified} />
              )}
              {'review' in a && a.review && (
                <ArticleReviewStateControl
                  articleId={a.id}
                  review={a.review}
                  canSupersede={'can_supersede' in a && a.can_supersede === true}
                  replacementOptions={replacementPool.filter((o) => o.id !== a.id)}
                  onChanged={onVerified}
                />
              )}
              <ArticleHistory articleId={a.id} />
              {'can_view_answers' in a && a.can_view_answers && <ArticleAnswers articleId={a.id} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

type ReviewFilter = 'all' | 'needs_review' | 'superseded'

function matchesReviewFilter(a: Article, filter: ReviewFilter): boolean {
  if (filter === 'all') return true
  return 'review' in a && a.review?.state === filter
}

function countReviewStates(articles: KBArticle[]): { needs_review: number; superseded: number } {
  let needsReview = 0
  let superseded = 0
  for (const a of articles) {
    if (a.review?.state === 'needs_review') needsReview++
    else if (a.review?.state === 'superseded') superseded++
  }
  return { needs_review: needsReview, superseded }
}

function emptyListMessage(filter: ReviewFilter, resolutionsOnly: boolean): string {
  if (filter === 'needs_review') return 'No articles need review.'
  if (filter === 'superseded') return 'No articles have been superseded.'
  if (resolutionsOnly) return 'No saved resolutions yet. Promote a resolved ticket from its detail page to add one.'
  return 'No articles match.'
}

const KB_TABS = [
  { id: 'manage', label: 'Sources' },
  { id: 'coverage', label: 'Knowledge coverage' },
  { id: 'review', label: 'Review' },
  { id: 'flags', label: 'Flagged answers' },
  { id: 'gaps', label: 'Knowledge gaps' },
] as const
type KBTabId = (typeof KB_TABS)[number]['id']

async function fetchKbArticles(): Promise<KBArticle[]> {
  const res = await fetch('/api/kb')
  const data = await res.json()
  return Array.isArray(data) ? (data as KBArticle[]) : []
}

export default function KBPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab')
  const activeTab: KBTabId =
    tabParam === 'coverage' || tabParam === 'review' || tabParam === 'flags' || tabParam === 'gaps' ? tabParam : 'manage'
  // How many unseen questions are waiting in the review queue; stays null for
  // workspaces without the feature, so no badge shows.
  const [pendingReview, setPendingReview] = useState<number | null>(null)
  const handleReviewCounts = useCallback((c: ReviewCounts) => setPendingReview(c.pending), [])
  // The same for answers visitors flagged as wrong.
  const [openFlags, setOpenFlags] = useState<number | null>(null)
  const handleFlagCounts = useCallback((c: FlagCounts) => setOpenFlags(c.open), [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/kb/flags?limit=0')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { counts?: FlagCounts } | null) => {
        if (!cancelled && data?.counts) setOpenFlags(data.counts.open)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/kb/review?limit=0')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { counts?: ReviewCounts } | null) => {
        if (!cancelled && data?.counts) setPendingReview(data.counts.pending)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // "+ KB" on the Knowledge Gaps page links here with ?sourceTicket=<id>; the
  // server action re-checks the workspace and role before returning any text.
  const sourceTicketParam = searchParams.get('sourceTicket')
  const [draft, setDraft] = useState<KnowledgeDraft | null>(null)
  const [loadError, setDraftError] = useState<string | null>(null)
  const sourceTicketValid = sourceTicketParam !== null && /^[1-9]\d{0,9}$/.test(sourceTicketParam)
  const draftError =
    sourceTicketParam !== null && !sourceTicketValid ? 'That ticket link is not valid.' : loadError

  useEffect(() => {
    if (sourceTicketParam === null || !sourceTicketValid) return
    let cancelled = false
    getTicketDraftAction(Number(sourceTicketParam))
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setDraftError(null)
          setDraft({ ticketId: result.ticketId, question: result.question, answer: result.answer })
        } else {
          setDraftError(result.error)
        }
      })
      .catch(() => {
        if (!cancelled) setDraftError('Could not load that ticket. Try again.')
      })
    return () => { cancelled = true }
  }, [sourceTicketParam, sourceTicketValid])

  function clearSourceTicket() {
    setDraft(null)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('sourceTicket')
    const qs = params.toString()
    router.replace(qs ? `/kb?${qs}` : '/kb', { scroll: false })
  }

  function setTab(id: KBTabId) {
    const params = new URLSearchParams(searchParams.toString())
    if (id === 'manage') params.delete('tab')
    else params.set('tab', id)
    const qs = params.toString()
    router.replace(qs ? `/kb?${qs}` : '/kb', { scroll: false })
  }

  const [articles, setArticles] = useState<Article[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sourcesKey, setSourcesKey] = useState(0)
  const [sourceTotals, setSourceTotals] = useState<{ sources: number; chunks: number } | null>(null)
  const [articleCount, setArticleCount] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'write' | 'file' | 'url' | null>(null)
  const [sortOrder, setSortOrder] = useState<ArticleSortOrder>('newest')
  const [resolutionsOnly, setResolutionsOnly] = useState(false)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  // The full list, kept apart from `articles` (which search replaces), so the
  // replacement picker and the filter counts always see every article.
  const [allArticles, setAllArticles] = useState<KBArticle[]>([])

  async function loadAll() {
    setLoading(true)
    try {
      const all = await fetchKbArticles()
      setArticles(all)
      setAllArticles(all)
      setArticleCount(all.length)
    } finally {
      setLoading(false)
    }
  }

  function refreshSources() {
    setSourcesKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    fetchKbArticles()
      .then((data) => {
        if (!cancelled) {
          setArticles(data)
          setAllArticles(data)
          setArticleCount(data.length)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Sorting and the filters apply to the plain list only. Search results keep
  // the order of their match score, and never include superseded articles.
  const visibleArticles = query.trim()
    ? articles
    : sortBySaved(
        articles.filter((a) => (!resolutionsOnly || isResolution(a)) && matchesReviewFilter(a, reviewFilter)),
        sortOrder
      )
  const reviewCounts = countReviewStates(allArticles)
  const replacementPool: ReplacementOption[] = allArticles
    .filter((a) => a.review?.state !== 'superseded')
    .map((a) => ({ id: a.id, question: a.question }))

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

  const github = useGitHubSync(() => { loadAll(); refreshSources() })
  const handleSourcesLoaded = useCallback((list: KBSource[]) => {
    setSourceTotals({ sources: list.length, chunks: list.reduce((n, s) => n + s.chunk_count, 0) })
  }, [])

  // The Sources tab reports its own totals when its list loads. On the other
  // tabs that list is not mounted, so the counts row would stay blank; load
  // them here instead.
  const totalsKnown = sourceTotals !== null
  useEffect(() => {
    if (activeTab === 'manage' || totalsKnown) return
    let cancelled = false
    fetchKbSources().then((list) => {
      if (!cancelled && list) handleSourcesLoaded(list)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeTab, totalsKnown, handleSourcesLoaded])

  // A ticket draft ("+ KB" on Knowledge Gaps) opens the write dialog on its own.
  const [openedDraft, setOpenedDraft] = useState<KnowledgeDraft | null>(null)
  if (draft && draft !== openedDraft) {
    setOpenedDraft(draft)
    setDialog('write')
  }

  const stats: { label: string; value: number | null; tab?: KBTabId }[] = [
    { label: 'Sources', value: sourceTotals?.sources ?? null },
    { label: 'Chunks', value: sourceTotals?.chunks ?? null },
    { label: 'Articles', value: articleCount },
    { label: 'Needs review', value: pendingReview, tab: 'review' },
  ]

  return (
    <Page>
      <PageHeader
        title="Knowledge Base"
        description="Give every channel one current, searchable source of truth."
        actions={
          <>
          <details className="group relative">
            <summary className="inline-flex cursor-pointer list-none items-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
              Connect
              <svg className="ml-1.5 h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <Link href="/integrations?tab=github" className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">GitHub repository</Link>
              <Link href="/integrations?tab=notion" className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Notion workspace</Link>
            </div>
          </details>
          <Button variant="secondary" onClick={() => setDialog('url')}>Import URL</Button>
          <Button variant="secondary" onClick={() => setDialog('file')}>Upload file</Button>
          <Button onClick={() => setDialog('write')}>+ Write answer</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => {
          const body = (
            <>
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stat.value ?? '–'}</p>
            </>
          )
          return stat.tab ? (
            <button
              key={stat.label}
              type="button"
              onClick={() => setTab(stat.tab!)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300"
            >
              {body}
            </button>
          ) : (
            <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4">{body}</div>
          )
        })}
      </div>

      <Modal
        open={dialog === 'write'}
        title="Write an answer"
        description={WRITE_ANSWER_INTRO}
        onClose={() => setDialog(null)}
      >
        <AddKnowledgeSection
          bare
          onAdded={loadAll}
          draft={draft}
          onDraftConsumed={() => { clearSourceTicket(); setDialog(null) }}
        />
      </Modal>
      <Modal
        open={dialog === 'file'}
        title="Upload file"
        description="PDF, DOCX, MD, TXT, CSV — up to 10 MB. Each file is chunked and embedded into the knowledge base."
        onClose={() => setDialog(null)}
      >
        <FileUploadSection onImported={() => { loadAll(); refreshSources() }} />
      </Modal>
      <Modal
        open={dialog === 'url'}
        title="Import from URL"
        description="Crawl a page or entire site and add the content to the knowledge base."
        onClose={() => setDialog(null)}
      >
        <UrlIngestSection onImported={() => { loadAll(); refreshSources() }} />
      </Modal>

      <div className="dashboard-tabs flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2" role="tablist">
        {KB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setTab(tab.id)}
            className={[
              'shrink-0 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'bg-[#082e50] text-white shadow-none'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            {tab.label}
            {tab.id === 'review' && pendingReview !== null && pendingReview > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums text-white">
                {pendingReview}
              </span>
            )}
            {tab.id === 'flags' && openFlags !== null && openFlags > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums text-white">
                {openFlags}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'coverage' ? (
        <CoverageTab />
      ) : activeTab === 'review' ? (
        <ReviewTab onCountsChange={handleReviewCounts} />
      ) : activeTab === 'flags' ? (
        <FlagsTab onCountsChange={handleFlagCounts} />
      ) : activeTab === 'gaps' ? (
        <GapsTab />
      ) : (
        <>

      {draftError && (
        <p role="alert" className="break-words rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {draftError}
        </p>
      )}
      <SourcesList
        key={sourcesKey}
        onDeleted={() => { loadAll(); refreshSources() }}
        onLoaded={handleSourcesLoaded}
        github={github}
      />
      <NotionKBSection hideWhenDisconnected onSynced={() => { loadAll(); refreshSources() }} />

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
        <>
          {!query.trim() && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                Sort
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as ArticleSortOrder)}
                  className="rounded-md border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700 sm:py-1"
                >
                  <option value="newest">Newest saved first</option>
                  <option value="oldest">Oldest saved first</option>
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-2 text-xs text-gray-500 sm:py-0">
                <input
                  type="checkbox"
                  checked={resolutionsOnly}
                  onChange={(e) => setResolutionsOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600"
                />
                Saved resolutions only
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500">
                Show
                <select
                  value={reviewFilter}
                  onChange={(e) => setReviewFilter(e.target.value as ReviewFilter)}
                  className="rounded-md border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700 sm:py-1"
                >
                  <option value="all">All articles</option>
                  <option value="needs_review">Needs review ({reviewCounts.needs_review})</option>
                  <option value="superseded">Superseded ({reviewCounts.superseded})</option>
                </select>
              </label>
            </div>
          )}
          {visibleArticles.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              {emptyListMessage(reviewFilter, resolutionsOnly)}
            </p>
          ) : (
            <ArticlesList
              articles={visibleArticles}
              replacementPool={replacementPool}
              onDeleted={loadAll}
              onVerified={loadAll}
            />
          )}
        </>
      )}
        </>
      )}
    </Page>
  )
}
