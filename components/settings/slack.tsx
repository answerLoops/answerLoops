'use client'

import { useState,useEffect,useCallback,useActionState,useTransition } from 'react'
import { useSearchParams,useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import { saveSlackChannelsAction,deleteSlackIntegrationAction,getCurrentDeploymentMode } from '@/app/actions/integrations'

interface SlackIntegration {
  id: number
  platform: string
  team_id: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
}


export function SlackIntegrationCard() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [integration, setIntegration] = useState<SlackIntegration | null | undefined>(undefined)
  const [editingChannels, setEditingChannels] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [selfHosted, setSelfHosted] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()

  const reload = useCallback(async () => {
    const data: SlackIntegration[] = await fetch('/api/integrations').then((r) => r.json())
    const found = data.find((i) => i.platform === 'slack') ?? null
    setIntegration(found)
    if (found) setSelectedChannels(found.channel_ids)
  }, [])

  useEffect(() => { reload() }, [reload])

  // The webhook Events API endpoint below is only actionable for
  // self-hosters running their own Slack app — on managed cloud there's one
  // shared platform app whose Event Subscriptions the operator configures
  // once, so a customer has nowhere to paste this and it's just confusing.
  useEffect(() => {
    getCurrentDeploymentMode().then((mode) => setSelfHosted(mode === 'self-hosted'))
  }, [])

  // Handle redirect back from Slack OAuth
  useEffect(() => {
    const connected = searchParams.get('slack_connected')
    const error = searchParams.get('slack_error')
    const team = searchParams.get('slack_team')
    if (connected === '1') {
      reload().then(() => {
        showToast(`Slack connected${team ? ` · ${team}` : ''}! Select channels below.`)
        setEditingChannels(true)
      })
      const url = new URL(window.location.href)
      url.searchParams.delete('slack_connected')
      url.searchParams.delete('slack_team')
      router.replace(url.pathname + url.search, { scroll: false })
    } else if (error) {
      showToast(`Slack connection failed: ${error}`)
      const url = new URL(window.location.href)
      url.searchParams.delete('slack_error')
      router.replace(url.pathname + url.search, { scroll: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load channel list when entering channel-editing mode
  useEffect(() => {
    if (!editingChannels || channels.length > 0) return
    setLoadingChannels(true)
    fetch('/api/slack/channels')
      .then((r) => r.json())
      .then((data: { id: string; name: string }[] | { error: string }) => {
        if (Array.isArray(data)) setChannels(data)
      })
      .catch(() => null)
      .finally(() => setLoadingChannels(false))
  }, [editingChannels, channels.length])

  const [channelSaveState, channelSaveAction, channelSavePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveSlackChannelsAction(prev, fd)
      if (!result?.error) {
        await reload()
        setEditingChannels(false)
        showToast(result?.warning ?? 'Slack channels saved')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteSlackIntegrationAction(prev, fd)
      if (!result?.error) {
        setIntegration(null)
        setEditingChannels(false)
        setChannels([])
        setSelectedChannels([])
      }
      return result
    },
    null
  )

  async function handleConnectSlack() {
    setConnecting(true)
    try {
      const res = await fetch('/api/slack/install')
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      } else {
        showToast(data.error ?? 'Failed to get Slack install URL')
        setConnecting(false)
      }
    } catch {
      showToast('Failed to connect to Slack')
      setConnecting(false)
    }
  }

  function toggleChannel(id: string) {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  if (integration === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = integration !== null && integration.enabled === 1
  const hasChannels = connected && integration.channel_ids.length > 0

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-sm font-bold">S</div>
            <div>
              <p className="text-sm font-medium text-gray-900">Slack</p>
              <p className="text-xs text-gray-500">
                {hasChannels
                  ? `Connected · Team ${integration.team_id ?? '?'} · ${integration.channel_ids.length} channel(s)`
                  : connected
                  ? 'Connected — no channels selected yet'
                  : 'Not connected'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hasChannels ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasChannels ? 'Active' : 'Inactive'}
            </span>
            {connected && !editingChannels && (
              <Button size="sm" variant="secondary" onClick={() => setEditingChannels(true)}>
                Edit channels &amp; deflections
              </Button>
            )}
          </div>
        </div>

        {/* Not connected: 1-click OAuth */}
        {!connected && !showManual && (
          <div className="space-y-3">
            <Button onClick={handleConnectSlack} disabled={connecting} size="sm">
              {connecting ? 'Redirecting…' : 'Add to Slack'}
            </Button>
            {selfHosted && (
              <p className="text-xs text-gray-400">
                Polling mode — no admin webhook required.{' '}
                <button
                  type="button"
                  className="underline text-gray-500 hover:text-gray-700"
                  onClick={() => setShowManual(true)}
                >
                  Set up manually instead
                </button>
              </p>
            )}
          </div>
        )}

        {/* Manual token entry (polling path — self-hosted only, bot process never polls on cloud) */}
        {!connected && showManual && selfHosted && (
          <ManualSlackForm
            onSaved={(warning) => { reload(); showToast(warning ?? 'Slack saved — polling mode active') }}
            onCancel={() => setShowManual(false)}
          />
        )}

        {/* Connected summary */}
        {connected && !editingChannels && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Bot Token" value="••••••••• (saved)" />
            {integration.team_id && <ReadOnlyRow label="Team ID" value={integration.team_id} />}
            <ReadOnlyRow label="Channels" value={integration.channel_ids.join(', ') || '— none selected'} />
            {integration.escalation_role_id && (
              <ReadOnlyRow label="Escalation Group ID" value={integration.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration.auto_deflect_enabled === 1} />
            </div>
          </div>
        )}

        {/* Channel picker (shown after OAuth or when editing) */}
        {connected && editingChannels && (
          <form
            action={(fd) => {
              fd.set('channelIds', selectedChannels.join(','))
              return channelSaveAction(fd)
            }}
            className="space-y-3"
          >
            <p className="text-xs font-medium text-gray-700">Select channels to monitor</p>
            {loadingChannels ? (
              <p className="text-xs text-gray-400">Loading channels…</p>
            ) : channels.length > 0 ? (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
                {channels.map((ch) => (
                  <label key={ch.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedChannels.includes(ch.id)}
                      onChange={() => toggleChannel(ch.id)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">#{ch.name}</span>
                    <span className="text-xs text-gray-400 font-mono ml-auto">{ch.id}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Could not load channel list. Enter channel IDs manually:</p>
                <input
                  name="channelIds"
                  type="text"
                  defaultValue={integration.channel_ids.join(', ')}
                  placeholder="C01234ABCDE, C09876ZYXWV"
                  className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                  onChange={(e) => setSelectedChannels(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Escalation User Group ID <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                name="escalationRoleId"
                type="text"
                defaultValue={integration.escalation_role_id ?? ''}
                placeholder="S0123ABCDE or U0123ABCDE"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confidence threshold <span className="text-gray-400 font-normal">(0–1)</span></label>
              <input
                name="confidenceThreshold"
                type="number"
                min="0"
                max="1"
                step="0.05"
                defaultValue={integration.confidence_threshold ?? 0.8}
                className="w-32 rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <ToggleSwitch
                name="autoDeflectEnabled"
                label="Automatic Deflections"
                confirmLabel="Slack"
                defaultChecked={integration.auto_deflect_enabled === 1}
              />
              <p className="text-xs text-gray-400 mt-1">
                When off, high-confidence answers are held as drafts awaiting approval instead of posting automatically — a brief acknowledgment is sent to the channel instead.
              </p>
            </div>
            {(channelSaveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(channelSaveState as { error?: string }).error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={channelSavePending}>
                {channelSavePending ? 'Saving…' : 'Save channels'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingChannels(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={deletePending}
                onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
              >
                {deletePending ? 'Removing…' : 'Disconnect'}
              </Button>
            </div>
          </form>
        )}

        {connected && !editingChannels && (
          <div className="space-y-2">
            {selfHosted && (
              <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Events API endpoint (for webhook mode):</p>
                <code className="text-xs text-gray-700 break-all font-mono">{'{YOUR_DOMAIN}'}/api/slack/events</code>
              </div>
            )}
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={deletePending}
              onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
            >
              {deletePending ? 'Removing…' : 'Disconnect Slack'}
            </Button>
          </div>
        )}

        {(deleteState as { error?: string } | null)?.error && (
          <p className="text-xs text-red-600">{(deleteState as { error?: string }).error}</p>
        )}
      </div>
    </>
  )
}

function ManualSlackForm({ onSaved, onCancel }: { onSaved: (warning?: string) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    // Import inline to avoid circular — action is already imported at top of file
    const { saveSlackIntegrationAction } = await import('@/app/actions/integrations')
    const result = await saveSlackIntegrationAction(null, fd)
    setSaving(false)
    if (result?.error) { setError(result.error); return }
    onSaved(result?.warning)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-gray-100 pt-3">
      <p className="text-xs text-gray-500 font-medium">Polling mode — no webhook required</p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Bot Token</label>
        <input name="botToken" type="password" autoComplete="new-password" placeholder="xoxb-…" className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Signing Secret <span className="text-gray-400 font-normal">(optional for polling)</span></label>
        <input name="signingSecret" type="password" autoComplete="new-password" placeholder="From Slack app Basic Information" className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Team ID</label>
        <input name="teamId" type="text" placeholder="T01234ABCDE" className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Channel IDs (comma-separated)</label>
        <input name="channelIds" type="text" placeholder="C01234ABCDE, C09876ZYXWV" className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Connect'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

