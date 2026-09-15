'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { GitHubRepo } from '@/types'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast } from '@/components/settings/shared'

export function GitHubIntegrationCard() {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [connecting, setConnecting] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  // Automatic Deflections stays edit-gated even here — same reasoning as the
  // other 5 platforms: it changes whether AI answers reach customers
  // unsupervised, so it shouldn't be a stray click away. Only this one field
  // is gated; Support routing and Knowledge Base sync stay directly editable.
  const [editingDeflectId, setEditingDeflectId] = useState<number | null>(null)
  const { toastMessage, showToast } = useToast()
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

  const syncKB = async (repoId: number) => {
    setSyncingId(repoId)
    try {
      const { synced } = await fetch(`/api/github/sync-kb?repo_id=${repoId}`).then((r) => r.json())
      showToast(`Synced ${synced} chunks to KB`)
      reload()
    } catch {
      showToast('KB sync failed')
    } finally {
      setSyncingId(null)
    }
  }

  const removeRepo = async (repoId: number) => {
    await fetch(`/api/github/repos/${repoId}`, { method: 'DELETE' })
    reload()
  }

  return (
    <div className="space-y-3">
      {toastMessage && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700">{toastMessage}</div>
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
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-800 font-mono">{repo.owner}/{repo.repo}</p>
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
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 mb-0.5">Automatic Deflections</p>
                        <p className="text-xs text-gray-500">When off, high-confidence AI answers are held as drafts awaiting approval instead of posting automatically — a brief acknowledgment comment is posted instead.</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
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
                      <label className="flex items-center gap-2 shrink-0 mt-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={repo.kb_enabled === 1}
                          onChange={(e) => updateSettings(repo.id, { kbEnabled: e.target.checked ? 1 : 0 })}
                          className="rounded"
                        />
                        <span className="text-xs text-gray-600">{repo.kb_enabled === 1 ? 'On' : 'Off'}</span>
                      </label>
                    </div>

                    {repo.kb_enabled === 1 && (
                      <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
                        <p className="text-xs text-gray-500">
                          {repo.kb_chunk_count > 0
                            ? `${repo.kb_chunk_count} chunks · last synced ${repo.kb_last_synced ? new Date(repo.kb_last_synced).toLocaleDateString() : 'never'}`
                            : 'Not yet synced'}
                        </p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => syncKB(repo.id)}
                          disabled={syncingId === repo.id}
                        >
                          {syncingId === repo.id ? 'Syncing…' : 'Sync now'}
                        </Button>
                      </div>
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

