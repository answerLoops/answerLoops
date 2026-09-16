'use client'

import { useState,useEffect,useActionState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import { saveTelegramIntegrationAction,deleteTelegramIntegrationAction } from '@/app/actions/integrations'

interface TelegramIntegration {
  id: number
  platform: string
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
}

export function TelegramIntegrationCard() {
  const [integration, setIntegration] = useState<TelegramIntegration | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [registering, setRegistering] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveTelegramIntegrationAction(prev, fd)
      if (!result?.error) {
        const updated = await fetch('/api/integrations').then((r) => r.json())
        setIntegration(updated.find((i: TelegramIntegration) => i.platform === 'telegram') ?? null)
        setEditing(false)
        showToast(result?.warning ?? 'Telegram connected — webhook registered')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteTelegramIntegrationAction(prev, fd)
      if (!result?.error) { setIntegration(null); setEditing(false) }
      return result
    },
    null
  )

  useEffect(() => {
    fetch('/api/integrations')
      .then((r) => r.json())
      .then((data: TelegramIntegration[]) => {
        setIntegration(data.find((i) => i.platform === 'telegram') ?? null)
      })
  }, [])

  async function handleRegisterWebhook() {
    setRegistering(true)
    try {
      const res = await fetch('/api/telegram/register', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string; webhookUrl?: string }
      if (data.ok) {
        showToast(`Webhook registered at ${data.webhookUrl}`)
      } else {
        showToast(data.error ?? 'Failed to register webhook')
      }
    } catch {
      showToast('Failed to register webhook')
    } finally {
      setRegistering(false)
    }
  }

  if (integration === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = integration !== null && integration.enabled === 1
  const showForm = !connected || editing

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 text-sm font-bold">T</div>
            <div>
              <p className="text-sm font-medium text-gray-900">Telegram</p>
              <p className="text-xs text-gray-500">
                {connected
                  ? `Connected · ${integration.channel_ids.length} chat(s) monitored`
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
                Edit chats &amp; deflections
              </Button>
            )}
          </div>
        </div>

        {connected && !editing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Bot Token" value="••••••••• (saved)" />
            <ReadOnlyRow label="Monitored chats" value={integration.channel_ids.join(', ') || '— (all chats)'} />
            {integration.escalation_role_id && (
              <ReadOnlyRow label="Escalation username" value={integration.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration.auto_deflect_enabled === 1} />
            </div>
          </div>
        )}

        {connected && !editing && (
          <div className="rounded-md bg-sky-50 border border-sky-100 p-3">
            <p className="text-xs text-sky-700 mb-2">
              After saving your token, register the webhook so Telegram starts delivering messages.
            </p>
            <Button type="button" size="sm" variant="secondary" disabled={registering} onClick={handleRegisterWebhook}>
              {registering ? 'Registering…' : 'Register webhook'}
            </Button>
          </div>
        )}

        {showForm && (
          <form key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bot Token</label>
              <input
                name="botToken"
                type="password"
                autoComplete="new-password"
                placeholder={connected ? '••••••••• (leave blank to keep current)' : '123456789:AAHdqTcv... (from @BotFather)'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Chat IDs to monitor <span className="text-gray-400 font-normal">(optional — leave blank to monitor all)</span>
              </label>
              <input
                name="chatIds"
                type="text"
                defaultValue={integration?.channel_ids.join(', ') ?? ''}
                placeholder="-1001234567890, -1009876543210"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Group/supergroup chat IDs are negative numbers. Forward a message to @userinfobot to get the chat ID.</p>
            </div>
            <hr className="border-gray-100" />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Escalation username <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                name="escalationUsername"
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
                confirmLabel="Telegram"
                defaultChecked={integration?.auto_deflect_enabled === 1}
              />
              <p className="text-xs text-gray-400 mt-1">
                When off, high-confidence answers are held as drafts awaiting approval instead of posting automatically — a brief acknowledgment is sent to the channel instead.
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

