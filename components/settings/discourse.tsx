'use client'

import { useState,useEffect,useActionState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import { saveDiscourseIntegrationAction,deleteDiscourseIntegrationAction } from '@/lib/actions/integrations'

interface DiscourseIntegration {
  id: number
  platform: string
  team_id: string | null
  bot_username: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
}

export function DiscourseIntegrationCard() {
  const [integration, setIntegration] = useState<DiscourseIntegration | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [webhookInfo, setWebhookInfo] = useState<{ url: string; secret: string } | null>(null)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveDiscourseIntegrationAction(prev, fd)
      if (!result?.error) {
        const updated = await fetch('/api/integrations').then((r) => r.json())
        setIntegration(updated.find((i: DiscourseIntegration) => i.platform === 'discourse') ?? null)
        setEditing(false)
        if (result?.webhookUrl && result?.webhookSecret) {
          setWebhookInfo({ url: result.webhookUrl, secret: result.webhookSecret })
        }
        showToast('Discourse settings updated')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteDiscourseIntegrationAction(prev, fd)
      if (!result?.error) { setIntegration(null); setEditing(false); setWebhookInfo(null) }
      return result
    },
    null
  )

  useEffect(() => {
    fetch('/api/integrations')
      .then((r) => r.json())
      .then((data: DiscourseIntegration[]) => {
        setIntegration(data.find((i) => i.platform === 'discourse') ?? null)
      })
  }, [])

  async function handleRegisterWebhook() {
    setRegistering(true)
    try {
      const res = await fetch('/api/discourse/register', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string; webhookUrl?: string }
      showToast(data.ok ? `Webhook registered at ${data.webhookUrl}` : (data.error ?? 'Failed to register webhook'))
    } catch {
      showToast('Failed to register webhook')
    } finally {
      setRegistering(false)
    }
  }

  if (integration === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = integration !== null && integration.enabled === 1 && !!integration.team_id
  const showForm = !connected || editing

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-sm font-bold">D</div>
            <div>
              <p className="text-sm font-medium text-gray-900">Discourse</p>
              <p className="text-xs text-gray-500">
                {connected
                  ? `Connected · ${integration.channel_ids.length || 'all'} categor${integration.channel_ids.length === 1 ? 'y' : 'ies'}`
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
                Edit categories &amp; deflections
              </Button>
            )}
          </div>
        </div>

        {connected && !editing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Site URL" value={integration.team_id ?? '—'} />
            <ReadOnlyRow label="API key" value="••••••••• (saved)" />
            <ReadOnlyRow label="Bot username" value={integration.bot_username ?? '—'} />
            <ReadOnlyRow label="Watched categories" value={integration.channel_ids.join(', ') || '— (all categories)'} />
            {integration.escalation_role_id && (
              <ReadOnlyRow label="Escalation user" value={integration.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration.auto_deflect_enabled === 1} />
            </div>
          </div>
        )}

        {connected && !editing && (
          <div className="rounded-md bg-orange-50 border border-orange-100 p-3 space-y-2">
            <p className="text-xs text-orange-700">
              Register the webhook so Discourse starts delivering new topics and posts.
            </p>
            <Button type="button" size="sm" variant="secondary" disabled={registering} onClick={handleRegisterWebhook}>
              {registering ? 'Registering…' : 'Register webhook'}
            </Button>
            {webhookInfo && (
              <div className="pt-1 text-xs text-orange-700/90 space-y-2">
                <p className="font-medium">Or add it manually in Discourse → Admin → API → Webhooks:</p>
                <div>
                  <p className="text-orange-700/70">Payload URL</p>
                  <p className="font-mono break-all select-all text-orange-900">{webhookInfo.url}</p>
                </div>
                <div>
                  <p className="text-orange-700/70">Secret</p>
                  <p className="font-mono break-all select-all text-orange-900">{webhookInfo.secret}</p>
                </div>
                <p>Subscribe to the <span className="font-mono">Topic Event</span> and <span className="font-mono">Post Event</span> groups.</p>
              </div>
            )}
          </div>
        )}

        {showForm && (
          <form key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Discourse site URL</label>
              <input
                name="siteUrl"
                type="url"
                defaultValue={integration?.team_id ?? ''}
                placeholder="https://forum.example.com"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API key</label>
              <input
                name="apiKey"
                type="password"
                autoComplete="new-password"
                placeholder={connected ? '••••••••• (leave blank to keep current)' : 'Admin → API → New API Key, scoped to a bot user'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bot username</label>
              <input
                name="botUsername"
                type="text"
                defaultValue={integration?.bot_username ?? ''}
                placeholder="answerloops-bot"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">The forum account replies are posted as. The API key must be scoped to this user (or be an all-users key).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Watched category IDs <span className="text-gray-400 font-normal">(optional — leave blank for all)</span>
              </label>
              <input
                name="categoryIds"
                type="text"
                defaultValue={integration?.channel_ids.join(', ') ?? ''}
                placeholder="12, 15"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Numeric category IDs, comma-separated. Find them in the category URL or category settings.</p>
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
                placeholder="username (without @)"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Mentioned when AI confidence is below threshold.</p>
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
              <p className="text-xs text-gray-400 mt-1">AI answers below this score trigger human escalation.</p>
            </div>
            <div>
              <ToggleSwitch
                name="autoDeflectEnabled"
                label="Automatic Deflections"
                confirmLabel="Discourse"
                defaultChecked={integration?.auto_deflect_enabled === 1}
              />
              <p className="text-xs text-gray-400 mt-1">
                When off, high-confidence answers are held as drafts awaiting approval instead of posting automatically.
              </p>
            </div>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : 'Update'}
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

