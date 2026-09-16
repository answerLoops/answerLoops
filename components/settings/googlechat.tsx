'use client'

import { useState,useEffect,useActionState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import { generateGoogleChatConnectCodeAction,saveGoogleChatSettingsAction,deleteGoogleChatIntegrationAction } from '@/app/actions/integrations'

interface GoogleChatIntegration {
  id: number
  platform: string
  team_id: string | null
  // The unpaired connect code lives here (bot_secret) until a space pairs;
  // after that the same column is the webhook verification secret.
  bot_secret: string | null
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
}


export function GoogleChatIntegrationCard() {
  const [integration, setIntegration] = useState<GoogleChatIntegration | null | undefined>(undefined)
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  // Must be awaited by callers before flipping `editing` back to false —
  // otherwise the read-only view re-renders from the still-stale
  // `integration` state one tick before this resolves, then flips again
  // once it does (the on→off→on flash the Google Chat toggle showed, unlike
  // Discord/Slack/Email's save handlers which already await their reload).
  async function reload() {
    const data: GoogleChatIntegration[] = await fetch('/api/integrations').then((r) => r.json())
    const row = data.find((i) => i.platform === 'google_chat') ?? null
    setIntegration(row)
    // Rehydrate an outstanding connect code so it survives a reload — it's
    // stored on the row (bot_secret) from the moment it's generated, but
    // was previously only kept in component state and lost on refresh,
    // which pushed users to regenerate and silently invalidate the code
    // they'd already posted in a space.
    if (row && row.enabled !== 1 && typeof row.bot_secret === 'string' && row.bot_secret.startsWith('gc_')) {
      setPendingCode(row.bot_secret)
    } else if (!row || row.enabled === 1) {
      setPendingCode(null)
    }
  }

  const [connectState, connectAction, connectPending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await generateGoogleChatConnectCodeAction(prev, fd)
      if (result && 'connectCode' in result && result.connectCode) {
        setPendingCode(result.connectCode)
      }
      return result
    },
    null
  )

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveGoogleChatSettingsAction(prev, fd)
      // saveGoogleChatSettingsAction returns plain `null` on success (same
      // as every other integration's save action) — `result && ...` is
      // falsy for `null`, so this branch never ran on a successful save at
      // all: no reload, no setEditing(false), no toast. Matches the
      // `!result?.error` check every other card in this file already uses.
      if (!result?.error) {
        await reload()
        setEditing(false)
        showToast('Google Chat settings saved')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteGoogleChatIntegrationAction(prev, fd)
      if (!result?.error) { setIntegration(null); setPendingCode(null); setEditing(false) }
      return result
    },
    null
  )

  useEffect(() => { reload() }, [])

  // While a code is outstanding, poll for the pairing so the user doesn't have
  // to sit on "Check connection status". Stops as soon as the space pairs.
  useEffect(() => {
    const isConnected = integration != null && integration.enabled === 1 && !!integration.team_id
    if (isConnected || !pendingCode) return
    const id = setInterval(() => { reload() }, 5000)
    return () => clearInterval(id)
  }, [integration, pendingCode])

  if (integration === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = integration !== null && integration.enabled === 1 && !!integration.team_id

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold">G</div>
            <div>
              <p className="text-sm font-medium text-gray-900">Google Chat</p>
              <p className="text-xs text-gray-500">{connected ? 'Connected · space paired' : 'Not connected'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {connected ? 'Active' : 'Inactive'}
            </span>
            {connected && !editing && (
              <Button
                size="sm"
                variant="danger"
                disabled={deletePending}
                onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
              >
                {deletePending ? 'Removing…' : 'Disconnect'}
              </Button>
            )}
          </div>
        </div>

        {!connected && !pendingCode && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 space-y-3">
            <p className="text-sm text-blue-900">
              Generate a connect code, add the answerLoops app to a Google Chat space, then post the code
              there to pair it with this workspace.
            </p>
            <form action={connectAction}>
              <Button type="submit" size="sm" disabled={connectPending}>
                {connectPending ? 'Generating…' : 'Generate connect code'}
              </Button>
            </form>
            {(connectState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(connectState as { error?: string }).error}</p>
            )}
          </div>
        )}

        {!connected && pendingCode && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-600">Your connect code</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="block min-w-0 flex-1 text-sm font-mono text-gray-900 bg-white border border-gray-200 rounded px-3 py-2 break-all select-all">
                {pendingCode}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(pendingCode).then(() => {
                    setCodeCopied(true)
                    setTimeout(() => setCodeCopied(false), 2000)
                  }).catch(() => {})
                }}
              >
                {codeCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <ol className="text-xs text-gray-500 list-decimal list-inside space-y-1">
              <li>Add the answerLoops app to a Google Chat space (see the self-hosting guide for the app link)</li>
              <li>Post <code className="font-mono">/connect {pendingCode}</code> in that space</li>
              <li>Keep this page open — it checks for the pairing automatically and switches to &quot;Connected&quot; on its own</li>
            </ol>
            <Button size="sm" variant="secondary" onClick={reload}>Check now</Button>
          </div>
        )}

        {connected && !editing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Connected space" value={integration!.team_id ?? '—'} />
            {integration!.escalation_role_id && (
              <ReadOnlyRow label="Escalation user" value={integration!.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration!.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration!.auto_deflect_enabled === 1} />
            </div>
          </div>
        )}

        {connected && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit escalation, confidence &amp; deflections
          </Button>
        )}

        {connected && editing && (
          <form action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Escalation user id (e.g. users/12345)</label>
              <input
                name="escalationUserId"
                defaultValue={integration!.escalation_role_id ?? ''}
                placeholder="users/123456789"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confidence threshold</label>
              <input
                name="confidenceThreshold"
                type="number"
                step="0.05"
                min="0"
                max="1"
                defaultValue={integration!.confidence_threshold ?? 0.8}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <ToggleSwitch
                name="autoDeflectEnabled"
                label="Automatic Deflections"
                confirmLabel="Google Chat"
                defaultChecked={integration!.auto_deflect_enabled === 1}
              />
              <p className="text-xs text-gray-400 mt-1">
                When off, high-confidence answers are held as drafts awaiting approval instead of posting automatically — a brief acknowledgment is sent to the space instead.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={savePending}>{savePending ? 'Saving…' : 'Save'}</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
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

