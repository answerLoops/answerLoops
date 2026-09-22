'use client'

import { useState,useEffect,useActionState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import { saveCircleIntegrationAction,deleteCircleIntegrationAction } from '@/lib/actions/integrations'

interface CircleIntegration {
  id: number
  platform: string
  team_id: string | null
  bot_secret: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  enabled: number
}

export function CircleIntegrationCard() {
  const [integration, setIntegration] = useState<CircleIntegration | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveCircleIntegrationAction(prev, fd)
      if (!result?.error) {
        const updated = await fetch('/api/integrations').then((r) => r.json())
        setIntegration(updated.find((i: CircleIntegration) => i.platform === 'circle') ?? null)
        setEditing(false)
        showToast('Circle settings updated')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteCircleIntegrationAction(prev, fd)
      if (!result?.error) { setIntegration(null); setEditing(false) }
      return result
    },
    null
  )

  useEffect(() => {
    fetch('/api/integrations')
      .then((r) => r.json())
      .then((data: CircleIntegration[]) => {
        setIntegration(data.find((i) => i.platform === 'circle') ?? null)
      })
  }, [])

  if (integration === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = integration !== null && integration.enabled === 1 && !!integration.team_id
  const showForm = !connected || editing
  const webhookBase = typeof window !== 'undefined' ? `${window.location.origin}/api/circle/webhook` : '/api/circle/webhook'
  const postWebhookUrl = `${webhookBase}?kind=post`
  const commentWebhookUrl = `${webhookBase}?kind=comment`

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
                Edit spaces
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
              {integration.escalation_role_id && (
                <ReadOnlyRow label="Escalation user" value={integration.escalation_role_id} />
              )}
              <ReadOnlyRow label="Confidence threshold" value={String(integration.confidence_threshold ?? 0.8)} />
            </div>
            <div className="rounded-md bg-violet-50 border border-violet-100 p-3 text-xs text-violet-800 space-y-2">
              <p>
                Circle is <span className="font-medium">ingest-only</span> — new posts and comments become tickets with an AI draft, but nothing is posted back to Circle automatically. A reviewer copies the answer into Circle by hand.
              </p>
              <p className="font-medium">In Circle → Settings → Workflows, create two workflows (action: <span className="font-mono">Send webhook</span> on both) so answerLoops knows which is which:</p>
              <div>
                <p className="text-violet-700/70">Trigger <span className="font-mono">New post</span> → Webhook URL</p>
                <p className="font-mono break-all select-all text-violet-900">{postWebhookUrl}</p>
              </div>
              <div>
                <p className="text-violet-700/70">Trigger <span className="font-mono">New comment</span> → Webhook URL</p>
                <p className="font-mono break-all select-all text-violet-900">{commentWebhookUrl}</p>
              </div>
              <div>
                <p className="text-violet-700/70">Header (on both) <span className="font-mono">X-AnswerLoops-Token</span></p>
                <p className="font-mono break-all select-all text-violet-900">{integration.bot_secret ?? '— (re-save to generate)'}</p>
              </div>
            </div>
          </>
        )}

        {showForm && (
          <form key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Circle community URL</label>
              <input
                name="communityUrl"
                type="url"
                defaultValue={integration?.team_id ?? ''}
                placeholder="https://community.example.com"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Admin API token</label>
              <input
                name="apiToken"
                type="password"
                autoComplete="new-password"
                placeholder={connected ? '••••••••• (leave blank to keep current)' : 'Developers → Tokens → new Admin V2 token'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Used to fetch the full post/comment body when a webhook payload is thin.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Watched space IDs <span className="text-gray-400 font-normal">(optional — leave blank for all)</span>
              </label>
              <input
                name="spaceIds"
                type="text"
                defaultValue={integration?.channel_ids.join(', ') ?? ''}
                placeholder="12345, 67890"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Numeric space IDs, comma-separated.</p>
            </div>
            <hr className="border-gray-100" />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Escalation user <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                name="escalationUser"
                type="text"
                defaultValue={integration?.escalation_role_id ?? ''}
                placeholder="username"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Noted on the draft when AI confidence is below threshold.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Confidence threshold <span className="text-gray-400 font-normal">(0–1, default 0.8)</span>
              </label>
              <input
                name="confidenceThreshold"
                type="number"
                min="0"
                max="1"
                step="0.05"
                defaultValue={integration?.confidence_threshold ?? 0.8}
                className="w-32 rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : connected ? 'Update' : 'Connect'}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              {connected && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={deletePending}
                  onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
                >
                  {deletePending ? 'Removing…' : 'Disconnect'}
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

