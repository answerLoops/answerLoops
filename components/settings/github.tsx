'use client'

import { RepoSyncStatus } from '@/components/kb/repo-sync-status'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { GitHubRepo } from '@/types'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast } from '@/components/settings/shared'
import { DocFolderPicker } from '@/components/settings/doc-folder-picker'
import { runKbSync } from '@/lib/kb/sync-client'

export function GitHubIntegrationCard() {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [connecting, setConnecting] = useState(false)
  // Per repo, the label of a sync in progress ("Queued…", "Syncing: …").
  const [syncLabels, setSyncLabels] = useState<Record<number, string>>({})
  // The repo whose docs folder picker is open. Switching Knowledge Base on
  // opens it; the repo is only switched on when the owner saves.
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  // A folder save is out for this repo; its Knowledge Base box is locked so
  // a quick untick can't race the save.
  const [savingFor, setSavingFor] = useState<number | null>(null)
  // Where keyboard focus goes back to once the picker closes.
  const focusAfterClose = useRef<string | null>(null)
  const stopped = useRef(false)
  useEffect(() => {
    stopped.current = false
    return () => { stopped.current = true }
  }, [])
  // Automatic Deflections stays edit-gated even here — same reasoning as the
  // other 5 platforms: it changes whether AI answers reach customers
  // unsupervised, so it shouldn't be a stray click away. Only this one field
  // is gated; Support routing and Knowledge Base sync stay directly editable.
  const [editingDeflectId, setEditingDeflectId] = useState<number | null>(null)
  const { toastMessage, toastKind, showToast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()

  const reload = useCallback(() => {
    fetch('/api/github/repos').then((r) => r.json()).then(setRepos)
  }, [])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const connected = searchParams.get('github_connected') === '1'
    const error = searchParams.get('github_error')
    if (!connected && !error) return
    if (connected) showToast('GitHub connected')
    if (error) showToast('GitHub connection failed. Try again.')
    // Remove params from URL without page reload — otherwise this effect
    // refires on every re-render (showToast gets a fresh ref each time),
    // showing the toast in an endless loop.
    const url = new URL(window.location.href)
    url.searchParams.delete('github_connected')
    url.searchParams.delete('github_error')
    router.replace(url.pathname + url.search, { scroll: false })
  }, [searchParams, showToast, router])

  const connect = async () => {
    setConnecting(true)
    try {
      const res = await fetch('/api/github/install-url')
      const data = await res.json()
      if (!res.ok || !data.url) {
        showToast(data.error ?? 'GitHub App not configured — set GITHUB_APP_SLUG env var')
        setConnecting(false)
        return
      }
      window.location.href = data.url
    } catch {
      showToast('Failed to get GitHub install URL')
      setConnecting(false)
    }
  }

  const updateSettings = async (repoId: number, patch: { monitoredEvents?: string; kbEnabled?: number; autoDeflectEnabled?: number }) => {
    await fetch('/api/github/repo-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, ...patch }),
    })
    reload()
    if ('autoDeflectEnabled' in patch) router.refresh()
  }

  const setLabel = (repoId: number, label: string | null) =>
    setSyncLabels((prev) => {
      const next = { ...prev }
      if (label === null) delete next[repoId]
      else next[repoId] = label
      return next
    })

  const syncKB = async (repo: GitHubRepo) => {
    setLabel(repo.id, 'Queued…')
    const result = await runKbSync(
      `/api/github/sync-kb?repo_id=${repo.id}`,
      `/api/kb/sync-jobs?kind=github_repo&repo_id=${repo.id}`,
      (label) => { if (!stopped.current) setLabel(repo.id, label) },
      () => stopped.current,
    )
    if (stopped.current) return
    showToast(`${repo.owner}/${repo.repo}: ${result.detail}`, result.ok ? 'success' : 'error')
    reload()
    setLabel(repo.id, null)
  }

  const closePicker = (repo: GitHubRepo, focusTarget: 'change' | 'toggle') => {
    focusAfterClose.current = `${focusTarget}-${repo.id}`
    setPickerFor(null)
  }

  const foldersSaved = (repo: GitHubRepo) => {
    setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, kb_enabled: 1 } : r)))
    closePicker(repo, 'change')
    reload()
    syncKB(repo)
  }

  // Runs once the picker has closed and the row it returns to has rendered.
  useEffect(() => {
    const target = focusAfterClose.current
    if (!target || pickerFor !== null) return
    const el = document.getElementById(`kb-${target}`)
    if (el) {
      el.focus()
      focusAfterClose.current = null
    }
  }, [pickerFor, repos])

  const removeRepo = async (repoId: number) => {
    const res = await fetch(`/api/github/repos/${repoId}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined
      showToast(body?.error ?? 'Could not remove the repository. Try again.', 'error')
      return
    }
    reload()
  }

  return (
    <div className="space-y-3">
      {toastMessage && (
        <div
          role={toastKind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-2 text-sm break-words ${toastKind === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}
        >
          {toastMessage}
        </div>
      )}

      {repos.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-8 text-center">
          <p className="text-sm font-medium text-gray-800 mb-1">Connect GitHub</p>
          <p className="text-xs text-gray-500 mb-1 max-w-sm mx-auto">Use repos as a support channel — turn Issues and Discussions into tickets with AI responses — or as a knowledge base by syncing your markdown docs.</p>
          <p className="text-xs text-amber-600 mb-5">You must be an org admin to install the GitHub App on an organization.</p>
          <Button onClick={connect} disabled={connecting}>
            {connecting ? 'Redirecting…' : 'Connect GitHub'}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {repos.map((repo) => (
              <div key={repo.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* Repo header */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 font-mono break-all">{repo.owner}/{repo.repo}</p>
                    <p className="text-xs text-gray-400">{repo.is_private ? 'Private' : 'Public'} · Added {new Date(repo.added_at).toLocaleDateString()}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeRepo(repo.id)}>Remove</Button>
                </div>

                <div className="divide-y divide-gray-100">
                  {/* ── Support ──────────────────────────────────────── */}
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 mb-0.5">Support</p>
                        <p className="text-xs text-gray-500">Turn Issues and Discussions into tickets. AI drafts responses and routes to your team.</p>
                      </div>
                      <select
                        value={repo.monitored_events}
                        onChange={(e) => updateSettings(repo.id, { monitoredEvents: e.target.value })}
                        className="text-xs border border-gray-200 rounded px-2 py-1.5 text-gray-700 shrink-0 mt-0.5"
                      >
                        <option value="both">Issues + Discussions</option>
                        <option value="issues">Issues only</option>
                        <option value="discussions">Discussions only</option>
                        <option value="none">Off</option>
                      </select>
                    </div>
                  </div>

                  {/* ── Automatic Deflections ────────────────────────── */}
                  <div className="px-4 py-4">
                    {/* Stacked on phones so the badge and button never squeeze the description. */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 mb-0.5">Automatic Deflections</p>
                        <p className="text-xs text-gray-500">When off, high-confidence AI answers are held as drafts awaiting approval instead of posting automatically. Nothing is posted to the issue until your team approves a draft.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:mt-0.5">
                        {editingDeflectId === repo.id ? (
                          <>
                            <ToggleSwitch
                              label=""
                              confirmLabel={`${repo.owner}/${repo.repo}`}
                              checked={repo.auto_deflect_enabled === 1}
                              onChange={(checked) => {
                                updateSettings(repo.id, { autoDeflectEnabled: checked ? 1 : 0 })
                                if (!checked) showToast(`Automatic Deflections turned off for ${repo.owner}/${repo.repo}`)
                              }}
                            />
                            <DeflectionStatusBadge enabled={repo.auto_deflect_enabled === 1} />
                            <Button size="sm" variant="ghost" onClick={() => setEditingDeflectId(null)}>Done</Button>
                          </>
                        ) : (
                          <>
                            <DeflectionStatusBadge enabled={repo.auto_deflect_enabled === 1} />
                            <Button size="sm" variant="secondary" onClick={() => setEditingDeflectId(repo.id)}>
                              Edit deflections
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Knowledge Base ───────────────────────────────── */}
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 mb-0.5">Knowledge Base</p>
                        <p className="text-xs text-gray-500">Sync markdown files from this repo as KB articles so the AI can reference your docs when answering questions.</p>
                      </div>
                      {repo.kb_enabled === 1 ? (
                        <label className="flex items-center gap-2 shrink-0 mt-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            id={`kb-toggle-${repo.id}`}
                            aria-label={`Knowledge Base for ${repo.owner}/${repo.repo}`}
                            checked
                            disabled={savingFor === repo.id}
                            onChange={() => {
                              setPickerFor(null)
                              updateSettings(repo.id, { kbEnabled: 0 })
                            }}
                            className="rounded"
                          />
                          <span className="text-xs text-gray-600">On</span>
                        </label>
                      ) : (
                        pickerFor !== repo.id && (
                          <Button
                            id={`kb-toggle-${repo.id}`}
                            size="sm"
                            variant="secondary"
                            className="shrink-0 whitespace-nowrap"
                            aria-label={`Set up Knowledge Base for ${repo.owner}/${repo.repo}`}
                            onClick={() => setPickerFor(repo.id)}
                          >
                            Choose folders
                          </Button>
                        )
                      )}
                    </div>

                    {repo.kb_enabled === 1 && pickerFor !== repo.id && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 bg-gray-50 rounded-md px-3 py-2">
                        <p className="min-w-0 text-xs text-gray-500">
                          <RepoSyncStatus repo={repo} />
                        </p>
                        <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0">
                          <Button
                            id={`kb-change-${repo.id}`}
                            size="sm"
                            variant="ghost"
                            className="whitespace-nowrap"
                            onClick={() => setPickerFor(repo.id)}
                            disabled={repo.id in syncLabels}
                          >
                            Change folders
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-w-0 max-w-full"
                            onClick={() => syncKB(repo)}
                            disabled={repo.id in syncLabels}
                          >
                            <span className="min-w-0 truncate">{syncLabels[repo.id] ?? 'Sync now'}</span>
                          </Button>
                        </div>
                      </div>
                    )}

                    {pickerFor === repo.id && (
                      <DocFolderPicker
                        repoId={repo.id}
                        onSaved={() => foldersSaved(repo)}
                        onCancel={() => closePicker(repo, repo.kb_enabled === 1 ? 'change' : 'toggle')}
                        onSavingChange={(saving) => setSavingFor(saving ? repo.id : null)}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button variant="secondary" size="sm" onClick={connect} disabled={connecting}>
            {connecting ? 'Redirecting…' : '+ Add more repos'}
          </Button>
        </>
      )}
    </div>
  )
}

