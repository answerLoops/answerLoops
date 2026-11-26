'use client'

import { useState,useEffect,useActionState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import {
  saveCircleIntegrationAction,
  deleteCircleIntegrationAction,
  rotateCircleSecretAction,
} from '@/lib/actions/integrations'

interface CircleIntegration {
  id: number
  platform: string
  team_id: string | null
  bot_secret: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  enabled: number
  /** The member email replies are posted as; null posts as the API token's admin. */
  bot_username: string | null
  team_member_ids: string[]
  auto_deflect_enabled: number
}

/** Reads this org's Circle row. Throws on a non-OK response or an unexpected body. */
async function fetchCircleIntegration(): Promise<CircleIntegration | null> {
  const res = await fetch('/api/integrations')
  if (!res.ok) throw new Error(`Loading integrations failed with status ${res.status}`)
  const data: unknown = await res.json()
  if (!Array.isArray(data)) throw new Error('Loading integrations returned an unexpected response')
  return (data as CircleIntegration[]).find((i) => i.platform === 'circle') ?? null
}

export function CircleIntegrationCard() {
  const [integration, setIntegration] = useState<CircleIntegration | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [confirmingRotate, setConfirmingRotate] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [rotated, setRotated] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const [rotatePending, startRotateTransition] = useTransition()
  const router = useRouter()

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveCircleIntegrationAction(prev, fd)
      if (!result?.error) {
        setEditing(false)
        setConfirmingDisconnect(false)
        showToast('Circle settings updated')
        router.refresh()
        try {
          setIntegration(await fetchCircleIntegration())
        } catch {
          // Saved, but the card could not read the row back: show the
          // load error with Retry instead of stale settings.
          setIntegration(undefined)
          setLoadError(true)
        }
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteCircleIntegrationAction(prev, fd)
      setConfirmingDisconnect(false)
      if (!result?.error) {
        setIntegration(null)
        setEditing(false)
        setRotated(false)
        showToast('Circle disconnected')
        router.refresh()
      }
      return result
    },
    null
  )

  useEffect(() => {
    let cancelled = false
    fetchCircleIntegration()
      .then((row) => { if (!cancelled) setIntegration(row) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [])

  function retryLoad() {
    setLoadError(false)
    fetchCircleIntegration()
      .then(setIntegration)
      .catch(() => setLoadError(true))
  }

  function rotateSecret() {
    setRotateError(null)
    startRotateTransition(async () => {
      const result = await rotateCircleSecretAction()
      setConfirmingRotate(false)
      if (result.error || !result.webhookSecret) {
        setRotateError(result.error ?? 'Could not rotate the secret. Try again.')
        return
      }
      const newSecret = result.webhookSecret
      setIntegration((prev) => (prev ? { ...prev, bot_secret: newSecret } : prev))
      setRotated(true)
      router.refresh()
    })
  }

  if (integration === undefined) {
    if (loadError) {
      return (
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-red-600 min-w-0">Couldn’t load Circle settings. Check your connection and try again.</p>
          <Button size="sm" variant="secondary" onClick={retryLoad}>
            Retry
          </Button>
        </div>
      )
    }
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const connected = integration !== null && integration.enabled === 1 && !!integration.team_id
  const showForm = !connected || editing
  const webhookBase = typeof window !== 'undefined' ? `${window.location.origin}/api/circle/webhook` : '/api/circle/webhook'
  // Circle's "Send to webhook" action cannot set headers, so the secret rides
  // in the Endpoint URL as ?token=. Built from the current secret, so a
  // rotation updates both URLs.
  const tokenParam = integration?.bot_secret ? `&token=${encodeURIComponent(integration.bot_secret)}` : ''
  const postWebhookUrl = `${webhookBase}?kind=post${tokenParam}`
  const commentWebhookUrl = `${webhookBase}?kind=comment${tokenParam}`

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-sm font-bold">C</div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Circle</p>
              <p className="text-xs text-gray-500 truncate">
                {connected
                  ? `Connected · ${integration.channel_ids.length || 'all'} space${integration.channel_ids.length === 1 ? '' : 's'}`
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
                Edit spaces &amp; deflections
              </Button>
            )}
          </div>
        </div>

        {connected && !editing && (
          <>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
              <ReadOnlyRow label="Community URL" value={integration.team_id ?? '—'} />
              <ReadOnlyRow label="API token" value="••••••••• (saved)" />
              <ReadOnlyRow label="Watched spaces" value={integration.channel_ids.join(', ') || '— (all spaces)'} />
              <ReadOnlyRow label="Post replies as" value={integration.bot_username ?? '— (the API token’s admin)'} />
              <ReadOnlyRow label="Team member IDs" value={integration.team_member_ids.join(', ') || '— (none)'} />
              <ReadOnlyRow label="Confidence threshold" value={String(integration.confidence_threshold ?? 0.8)} />
              <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="text-gray-500 shrink-0">Automatic Deflections</span>
                <DeflectionStatusBadge enabled={integration.auto_deflect_enabled === 1} />
              </div>
            </div>
            <div className="rounded-md bg-violet-50 border border-violet-100 p-3 text-xs text-violet-800 space-y-2">
              <p>
                New posts and comments become tickets with an AI draft. answerLoops posts replies as comments on the Circle post, when your team approves a draft or sends a reply, or right away for confident answers when Automatic Deflections is on.
              </p>
              <p className="font-medium">In Circle → Workflows (left sidebar), create two workflows with the action <span className="font-mono">Send to webhook</span>, and paste these Endpoint URLs:</p>
              <div>
                <p className="text-violet-700/70">Trigger <span className="font-mono">Published a post</span> → Endpoint URL</p>
                <p className="font-mono break-all select-all text-violet-900">{postWebhookUrl}</p>
              </div>
              <div>
                <p className="text-violet-700/70">Trigger <span className="font-mono">Posted a comment</span> → Endpoint URL</p>
                <p className="font-mono break-all select-all text-violet-900">{commentWebhookUrl}</p>
              </div>
              <div>
                <p className="text-violet-700/70">Secret (already in both URLs; an <span className="font-mono">X-AnswerLoops-Token</span> header also works)</p>
                <p className="font-mono break-all select-all text-violet-900">{integration.bot_secret ?? '— (re-save to generate)'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {rotated && (
                <p aria-live="polite" className="rounded-md bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
                  Secret rotated. Paste the new Endpoint URLs above into both Circle Workflows, the one for new posts and the one for new comments. Until you do, they won’t create tickets.
                </p>
              )}
              {confirmingRotate ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs text-amber-900">
                    Rotate the secret? The current one stops working right away. You’ll need to update the Endpoint URL in both Circle Workflows with the new secret, the one for new posts and the one for new comments.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="danger" disabled={rotatePending} onClick={rotateSecret}>
                      {rotatePending ? 'Rotating…' : 'Yes, rotate'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={rotatePending} onClick={() => setConfirmingRotate(false)}>
                      Keep current secret
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setRotateError(null); setConfirmingRotate(true) }}
                  >
                    Rotate secret
                  </Button>
                </div>
              )}
              {rotateError && <p className="text-xs text-red-600">{rotateError}</p>}
            </div>
          </>
        )}

        {showForm && (
          <form key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-3">
            <div>
              <label htmlFor="circle-community-url" className="block text-xs font-medium text-gray-600 mb-1">Circle community URL</label>
              <input
                id="circle-community-url"
                name="communityUrl"
                type="url"
                defaultValue={integration?.team_id ?? ''}
                placeholder="https://community.example.com"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="circle-api-token" className="block text-xs font-medium text-gray-600 mb-1">Admin API token</label>
              <input
                id="circle-api-token"
                name="apiToken"
                type="password"
                autoComplete="new-password"
                placeholder={connected ? '••••••••• (leave blank to keep current)' : 'Developers → Tokens → new Admin V2 token'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Used to post replies, and to fetch the full post or comment when a webhook payload is thin.</p>
            </div>
            <div>
              <label htmlFor="circle-space-ids" className="block text-xs font-medium text-gray-600 mb-1">
                Watched space IDs <span className="text-gray-400 font-normal">(optional — leave blank for all)</span>
              </label>
              <input
                id="circle-space-ids"
                name="spaceIds"
                type="text"
                defaultValue={integration?.channel_ids.join(', ') ?? ''}
                placeholder="12345, 67890"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Numeric space IDs, comma-separated.</p>
            </div>
            <div>
              <label htmlFor="circle-post-as" className="block text-xs font-medium text-gray-600 mb-1">
                Post replies as <span className="text-gray-400 font-normal">(optional — leave blank for the admin)</span>
              </label>
              <input
                id="circle-post-as"
                name="postAsEmail"
                type="email"
                defaultValue={integration?.bot_username ?? ''}
                placeholder="support@example.com"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">The email of the community member replies are posted as. A dedicated member works best, so your own comments stay yours.</p>
            </div>
            <div>
              <label htmlFor="circle-team-member-ids" className="block text-xs font-medium text-gray-600 mb-1">
                Team member Circle IDs <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="circle-team-member-ids"
                name="teamMemberIds"
                type="text"
                defaultValue={integration?.team_member_ids.join(', ') ?? ''}
                placeholder="1001, 1002"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Numeric member IDs, comma-separated. Their comments are kept on the ticket for context and never open a ticket.</p>
            </div>
            <hr className="border-gray-100" />
            <div>
              <label htmlFor="circle-confidence-threshold" className="block text-xs font-medium text-gray-600 mb-1">
                Confidence threshold <span className="text-gray-400 font-normal">(0–1, default 0.8)</span>
              </label>
              <input
                id="circle-confidence-threshold"
                name="confidenceThreshold"
                type="number"
                min="0"
                max="1"
                step="0.05"
                defaultValue={integration?.confidence_threshold ?? 0.8}
                className="w-32 rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <ToggleSwitch
                name="autoDeflectEnabled"
                label="Automatic Deflections"
                confirmLabel="Circle"
                defaultChecked={integration?.auto_deflect_enabled === 1}
              />
              <p className="text-xs text-gray-400 mt-1">
                When off, high-confidence answers are held as drafts awaiting approval instead of posting automatically. Nothing is posted in Circle until your team approves a draft.
              </p>
            </div>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : connected ? 'Update' : 'Connect'}
              </Button>
              {editing && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => { setEditing(false); setConfirmingDisconnect(false) }}
                >
                  Cancel
                </Button>
              )}
              {connected && !confirmingDisconnect && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={deletePending}
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  Disconnect
                </Button>
              )}
            </div>
            {connected && confirmingDisconnect && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="text-xs text-red-800">
                  <span className="font-medium">Disconnect Circle?</span> New posts stop creating tickets. Reconnecting generates a new secret, so both Workflow URLs will need updating.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={deletePending}
                    onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
                  >
                    {deletePending ? 'Disconnecting…' : 'Yes, disconnect'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={deletePending}
                    onClick={() => setConfirmingDisconnect(false)}
                  >
                    Keep connected
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}

        {(deleteState as { error?: string } | null)?.error && (
          <p className="text-xs text-red-600">{(deleteState as { error?: string }).error}</p>
        )}
      </div>
    </>
  )
}

