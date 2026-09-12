'use client'

import { useActionState, useRef, useTransition } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { updateSLAAction } from '@/app/actions/sla'
import { saveDiscordIntegrationAction, deleteDiscordIntegrationAction, saveDiscordGuildChannelsAction, removeDiscordGuildAction, updateDiscordAutoDeflectAction, saveSlackChannelsAction, deleteSlackIntegrationAction, saveTelegramIntegrationAction, deleteTelegramIntegrationAction, saveDiscourseIntegrationAction, deleteDiscourseIntegrationAction, saveCircleIntegrationAction, deleteCircleIntegrationAction, saveEmailIntegrationAction, deleteEmailIntegrationAction, startEmailDomainVerificationAction, checkEmailDomainVerificationAction, removeEmailDomainAction, disconnectOauthAction, generateGoogleChatConnectCodeAction, saveGoogleChatSettingsAction, deleteGoogleChatIntegrationAction, getCurrentDeploymentMode } from '@/app/actions/integrations'
import { sendInviteAction, revokeInviteAction, removeMemberAction, transferOwnershipAction } from '@/app/actions/invitations'
import { getWidgetTokenAction, regenerateWidgetTokenAction, saveWidgetOriginsAction } from '@/app/actions/widget'
import { saveAIConfigAction, clearAIConfigAction, testAIConfigAction } from '@/app/actions/ai-config'
import type { AIConnectionResult } from '@/lib/ai/test-connection'
import { saveROIConfigAction } from '@/app/actions/roi'
import { createApiKeyAction, revokeApiKeyAction } from '@/app/actions/api-keys'
import { API_SCOPES, ALL_SCOPES } from '@/lib/agent/scopes'
import { deleteAccountAction, getCurrentOrgName } from '@/app/actions/account'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import type { SLAConfig, GitHubRepo, NotionConnection } from '@/types'
import { saveNotionConnectionAction, deleteNotionConnectionAction } from '@/app/actions/notion'
import { subscribeLiveEvents } from '@/lib/live-events'

interface Member {
  membership_id: number
  user_id: number
  role: string
  joined_at: string
  email: string | null
  name: string | null
}

interface PendingInvite {
  id: number
  email: string
  role: string
  expires_at: string
  token: string
}

interface DiscordIntegration {
  id: number
  platform: string
  channel_ids: string[]
  connected_guild_id: string | null
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
}

interface DiscordGuild {
  id: number
  guild_id: string
  guild_name: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  enabled: number
}

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

function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const show = (msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), 3000)
  }
  return { toastMessage: message, showToast: show }
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl animate-in fade-in slide-in-from-bottom-2">
      <svg className="h-4 w-4 shrink-0 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {message}
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="font-mono text-gray-700 truncate text-right">{value}</span>
    </div>
  )
}

function SLARow({ config }: { config: SLAConfig }) {
  const [state, formAction, isPending] = useActionState(updateSLAAction, null)

  return (
    <form action={formAction} className="grid grid-cols-4 items-center">
      <input type="hidden" name="priority" value={config.priority} />
      <div className="px-4 py-3 text-sm font-medium capitalize text-gray-800">{config.priority}</div>
      <div className="px-4 py-3">
        <input type="number" name="responseHours" defaultValue={config.response_hours} min={1}
          className="w-20 rounded border border-gray-200 px-2 py-1 text-sm text-center" />
      </div>
      <div className="px-4 py-3">
        <input type="number" name="resolveHours" defaultValue={config.resolve_hours} min={1}
          className="w-20 rounded border border-gray-200 px-2 py-1 text-sm text-center" />
      </div>
      <div className="px-4 py-3 flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  )
}

function DiscordIntegrationCard() {
  // Legacy manual bot-token connection (self-hosters) — separate from and
  // independent of the OAuth-connected guilds list below.
  const [integration, setIntegration] = useState<DiscordIntegration | null | undefined>(undefined)
  const [legacyEditing, setLegacyEditing] = useState(false)
  // OAuth-connected servers — an org can have any number of these.
  const [guilds, setGuilds] = useState<DiscordGuild[] | undefined>(undefined)
  const [inviting, setInviting] = useState(false)
  const [justConnectedGuildId, setJustConnectedGuildId] = useState<string | null>(null)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const searchParams = useSearchParams()
  const router = useRouter()

  const reloadIntegration = useCallback(() => {
    return fetch('/api/integrations')
      .then((r) => r.json())
      .then((data: DiscordIntegration[]) => {
        const discord = data.find((i) => i.platform === 'discord') ?? null
        setIntegration(discord)
        return discord
      })
  }, [])

  const reloadGuilds = useCallback(() => {
    return fetch('/api/discord/guilds/connected')
      .then((r) => r.json())
      .then((data: DiscordGuild[]) => {
        setGuilds(data)
        return data
      })
  }, [])

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveDiscordIntegrationAction(prev, fd)
      if (!result?.error) {
        await reloadIntegration()
        setLegacyEditing(false)
        showToast('Discord settings updated')
        // The dashboard banner and Settings tab-bar red dots are populated
        // by a server component (app/(dashboard)/layout.tsx) that only
        // re-queries on full navigation — without this, they stay stale
        // until the next page load even though this card's own state is
        // already correct.
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteDiscordIntegrationAction(prev, fd)
      if (!result?.error) { setIntegration(null); setLegacyEditing(false) }
      return result
    },
    null
  )

  useEffect(() => {
    reloadIntegration()
    reloadGuilds()
  }, [reloadIntegration, reloadGuilds])

  // Handle redirect back from Discord OAuth
  useEffect(() => {
    const connected = searchParams.get('discord_connected')
    const guildId = searchParams.get('guild_id')
    const error = searchParams.get('discord_error')
    if (connected === '1') {
      reloadGuilds().then(() => {
        showToast('Discord server connected! Select channels below.')
        if (guildId) setJustConnectedGuildId(guildId)
      })
      // Remove params from URL without page reload
      const url = new URL(window.location.href)
      url.searchParams.delete('discord_connected')
      url.searchParams.delete('guild_id')
      router.replace(url.pathname + url.search, { scroll: false })
    } else if (error) {
      showToast(
        error === 'guild_already_connected'
          ? 'That Discord server is already connected to another answerLoops account.'
          : `Discord connection failed: ${error}`
      )
      const url = new URL(window.location.href)
      url.searchParams.delete('discord_error')
      router.replace(url.pathname + url.search, { scroll: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleAddToDiscord() {
    setInviting(true)
    try {
      const res = await fetch('/api/discord/invite-url')
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      } else {
        showToast(data.error ?? 'Failed to get invite URL')
        setInviting(false)
      }
    } catch {
      showToast('Failed to get invite URL')
      setInviting(false)
    }
  }

  if (integration === undefined || guilds === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const legacyConnected = integration !== null && integration.enabled === 1

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-sm font-bold">D</div>
            <div>
              <p className="text-sm font-medium text-gray-900">Discord</p>
              <p className="text-xs text-gray-500">
                {guilds.length > 0
                  ? `${guilds.length} server${guilds.length === 1 ? '' : 's'} connected`
                  : legacyConnected
                  ? `Connected · ${integration!.channel_ids.length} channel(s)`
                  : 'Not connected'}
              </p>
            </div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${guilds.length > 0 || legacyConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {guilds.length > 0 || legacyConnected ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* One-click connect — always available, even with servers already connected */}
        <div className="rounded-lg bg-brand-50 border border-brand-100 p-4 space-y-3">
          <p className="text-sm text-gray-700">
            {guilds.length > 0
              ? 'Connect another Discord server with one click.'
              : 'Add answerLoops to your Discord server with one click — no bot token or Developer Portal required.'}
          </p>
          <Button type="button" size="sm" disabled={inviting} onClick={handleAddToDiscord}>
            {inviting ? 'Redirecting…' : 'Add answerLoops to Discord'}
          </Button>
        </div>

        {guilds.map((guild) => (
          <DiscordGuildCard
            key={guild.id}
            guild={guild}
            onChanged={reloadGuilds}
            showToast={showToast}
            autoEdit={guild.guild_id === justConnectedGuildId}
            onAutoEditConsumed={() => setJustConnectedGuildId(null)}
          />
        ))}

        {/* Automatic Deflections is one setting per org, not per guild — the
            legacy card below can set it, but that card only renders for a
            manual-bot-token connection. OAuth-connected orgs have no other
            way to reach it, so this stands on its own whenever any guild is
            connected via OAuth. */}
        {guilds.length > 0 && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <span className="text-xs font-medium text-gray-600">Automatic Deflections</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  When off, high-confidence answers are held as drafts awaiting approval instead of posting automatically — a brief acknowledgment is sent to the channel instead.
                </p>
              </div>
              <ToggleSwitch
                label=""
                confirmLabel="Discord"
                checked={integration?.auto_deflect_enabled === 1}
                onChange={async (checked) => {
                  const result = await updateDiscordAutoDeflectAction(checked)
                  if (result?.error) { showToast(result.error); return }
                  await reloadIntegration()
                  router.refresh()
                }}
              />
            </div>
          </div>
        )}

        {/* Legacy manual setup — shown only when connected without any OAuth guild */}
        {legacyConnected && !legacyEditing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Bot Token" value="••••••••• (saved)" />
            <ReadOnlyRow label="Channel IDs" value={integration!.channel_ids.join(', ') || '—'} />
            {integration!.escalation_role_id && (
              <ReadOnlyRow label="Escalation Role ID" value={integration!.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration!.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration!.auto_deflect_enabled === 1} />
            </div>
            <div className="pt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setLegacyEditing(true)}>
                Edit channels &amp; deflections
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
          </div>
        )}

        {legacyConnected && legacyEditing && (
          <form action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Channel IDs</label>
              <input
                name="channelIds"
                type="text"
                defaultValue={integration!.channel_ids.join(', ')}
                placeholder="123456789, 987654321"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Escalation Role ID <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                name="escalationRoleId"
                type="text"
                defaultValue={integration!.escalation_role_id ?? ''}
                placeholder="Discord role ID — e.g. 123456789012345678"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
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
                defaultValue={integration!.confidence_threshold ?? 0.8}
                className="w-32 rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <ToggleSwitch
                name="autoDeflectEnabled"
                label="Automatic Deflections"
                confirmLabel="Discord"
                defaultChecked={integration!.auto_deflect_enabled === 1}
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
                {savePending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLegacyEditing(false)}>
                Cancel
              </Button>
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

function DiscordGuildCard({
  guild,
  onChanged,
  showToast,
  autoEdit,
  onAutoEditConsumed,
}: {
  guild: DiscordGuild
  onChanged: () => Promise<DiscordGuild[]>
  showToast: (msg: string) => void
  autoEdit: boolean
  onAutoEditConsumed: () => void
}) {
  const [editingChannels, setEditingChannels] = useState(autoEdit)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [, startRemoveTransition] = useTransition()

  // Open the channel picker automatically right after this specific server
  // was connected via OAuth — matches the pre-multi-server single-click flow
  // instead of forcing an extra "Edit channels" click.
  useEffect(() => {
    if (!autoEdit) return
    setEditingChannels(true)
    onAutoEditConsumed()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit])

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveDiscordGuildChannelsAction(prev, fd)
      if (!result?.error) {
        await onChanged()
        setEditingChannels(false)
        showToast('Channels updated')
      }
      return result
    },
    null
  )

  const [removeState, removeAction, removePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await removeDiscordGuildAction(prev, fd)
      if (!result?.error) await onChanged()
      return result
    },
    null
  )

  useEffect(() => {
    if (!editingChannels || channels.length > 0) return
    fetch(`/api/discord/guilds?guild_id=${guild.guild_id}`)
      .then((r) => r.json())
      .then((data: { channels?: { id: string; name: string }[] }) => setChannels(data.channels ?? []))
      .catch(() => null)
  }, [editingChannels, channels.length, guild.guild_id])

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">{guild.guild_name ?? `Server ${guild.guild_id}`}</p>
        {!editingChannels && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditingChannels(true)}>
              Edit channels
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={removePending}
              onClick={() => startRemoveTransition(() => {
                const fd = new FormData()
                fd.set('guildId', guild.guild_id)
                removeAction(fd)
              })}
            >
              {removePending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        )}
      </div>

      {!editingChannels && (
        <div className="divide-y divide-gray-100">
          <ReadOnlyRow label="Server ID" value={guild.guild_id} />
          <ReadOnlyRow label="Monitored channels" value={guild.channel_ids.join(', ') || '— (none selected)'} />
          {guild.escalation_role_id && (
            <ReadOnlyRow label="Escalation Role ID" value={guild.escalation_role_id} />
          )}
        </div>
      )}

      {editingChannels && (
        <form action={saveAction} className="space-y-3">
          <input type="hidden" name="guildId" value={guild.guild_id} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Channels to monitor
              {channels.length === 0 && <span className="text-gray-400 font-normal ml-1">(loading…)</span>}
            </label>
            {channels.length > 0 ? (
              <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto rounded border border-gray-200 p-2 bg-white">
                {channels.map((ch) => (
                  <label key={ch.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                    <input
                      type="checkbox"
                      name="channelIds"
                      value={ch.id}
                      defaultChecked={guild.channel_ids.includes(ch.id)}
                      className="rounded"
                    />
                    #{ch.name}
                  </label>
                ))}
              </div>
            ) : (
              <input
                name="channelIds"
                type="text"
                defaultValue={guild.channel_ids.join(', ')}
                placeholder="123456789, 987654321"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
            )}
          </div>
          <hr className="border-gray-100" />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Escalation Role ID <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              name="escalationRoleId"
              type="text"
              defaultValue={guild.escalation_role_id ?? ''}
              placeholder="Discord role ID — e.g. 123456789012345678"
              className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">When AI confidence is below threshold, this role gets @mentioned in the thread.</p>
          </div>
          {(saveState as { error?: string } | null)?.error && (
            <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={savePending}>
              {savePending ? 'Saving…' : 'Save channels'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingChannels(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {(removeState as { error?: string } | null)?.error && (
        <p className="text-xs text-red-600">{(removeState as { error?: string }).error}</p>
      )}
    </div>
  )
}

function SlackIntegrationCard() {
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

interface TelegramIntegration {
  id: number
  platform: string
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
}

function TelegramIntegrationCard() {
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

interface EmailIntegration {
  id: number
  platform: string
  bot_token: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
  bot_secret?: string | null
  email_send_method: string
}

interface EmailDomain {
  id: number
  domain: string
  dkim_record_name: string | null
  dkim_record_value: string | null
  return_path_record_name: string | null
  return_path_record_value: string | null
  receiving_record_name: string | null
  receiving_record_value: string | null
  receiving_record_priority: number | null
  dmarc_suggestion: string | null
  status: 'pending' | 'verified' | 'failed'
}

// "Use your own domain" section of EmailIntegrationCard — registers a
// domain, shows the DNS records to add, checks verification status on demand,
// then hands off to reply.ts once verified.
function EmailDomainSection({ onVerified }: { onVerified: () => void }) {
  const [emailDomain, setEmailDomain] = useState<EmailDomain | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [, startRemoveTransition] = useTransition()

  async function reload() {
    setLoadError(null)
    try {
      const response = await fetch('/api/email-domain')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data: EmailDomain | null = await response.json()
      setEmailDomain(data)
      if (data?.status === 'verified') onVerified()
    } catch {
      // Keep the setup form usable when the status check is temporarily
      // unavailable. Previously this left emailDomain undefined forever and
      // rendered a blank panel, making the first method choice appear broken.
      setEmailDomain(null)
      setLoadError('Could not check for an existing domain. You can still try adding one.')
    }
  }

  // Mount-only. `reload` is redeclared every render and closes over the
  // `onVerified` prop, which the parent does not memoize — adding either to the
  // dep array re-runs this fetch on every parent render rather than once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [])

  const [startState, startAction, startPending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await startEmailDomainVerificationAction(prev, fd)
      if (!result?.error) await reload()
      return result
    },
    null
  )

  const [checkState, checkAction, checkPending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await checkEmailDomainVerificationAction(prev, fd)
      if (!result?.error) await reload()
      return result
    },
    null
  )

  // The modal stays mounted while the action runs so its pending state and any
  // error remain visible. On success setEmailDomain(null) unmounts the whole
  // verified-domain block, which takes the modal with it.
  const [showRemoveDomainModal, setShowRemoveDomainModal] = useState(false)
  const [removeState, removeAction, removePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await removeEmailDomainAction(prev, fd)
      if (!result?.error) setEmailDomain(null)
      return result
    },
    null
  )

  function copy(field: string, value: string) {
    navigator.clipboard.writeText(value)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  if (emailDomain === undefined) {
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
        <p className="text-xs text-gray-500">Loading domain setup…</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-3">
      <p className="text-sm font-medium text-gray-700">Connect your support email</p>
      <p className="text-xs text-gray-500">
        Customers will email <code className="font-mono">support@yourdomain</code>. Their messages will become tickets here,
        and replies will be sent from <code className="font-mono">noreply@yourdomain</code>.
      </p>
      {loadError && <p className="text-xs text-amber-700">{loadError}</p>}

      {emailDomain === null && (
        <form action={startAction} className="flex flex-wrap items-center gap-2">
          <input
            name="domain"
            type="text"
            placeholder="yourcompany.com"
            className="flex-1 min-w-[10rem] rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
          />
          <Button type="submit" size="sm" disabled={startPending}>
            {startPending ? 'Starting setup…' : 'Continue'}
          </Button>
        </form>
      )}
      {(startState as { error?: string } | null)?.error && (
        <p className="text-xs text-red-600">{(startState as { error?: string }).error}</p>
      )}

      {emailDomain?.status === 'pending' && (
        <div className="space-y-2">
          <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3 space-y-1">
            <p className="text-xs font-medium text-gray-700">Almost there</p>
            <p className="text-xs text-gray-600">
              Add these records wherever your DNS is managed (usually your domain registrar). They verify outgoing mail
              and route customer emails into your tickets.
            </p>
          </div>
          {emailDomain.dkim_record_name && emailDomain.dkim_record_value && (
            <DnsRecordRow
              label="Verify outgoing mail"
              name={emailDomain.dkim_record_name}
              value={emailDomain.dkim_record_value}
              copied={copiedField === 'dkim'}
              onCopy={() => copy('dkim', emailDomain.dkim_record_value!)}
            />
          )}
          {emailDomain.return_path_record_name && emailDomain.return_path_record_value && (
            <DnsRecordRow
              label="Authorize outgoing mail"
              name={emailDomain.return_path_record_name}
              value={emailDomain.return_path_record_value}
              copied={copiedField === 'returnPath'}
              onCopy={() => copy('returnPath', emailDomain.return_path_record_value!)}
            />
          )}
          {emailDomain.receiving_record_name && emailDomain.receiving_record_value && (
            <DnsRecordRow
              label="Receive customer emails"
              name={emailDomain.receiving_record_name}
              value={emailDomain.receiving_record_value}
              copied={copiedField === 'receiving'}
              onCopy={() => copy('receiving', emailDomain.receiving_record_value!)}
            />
          )}
          {emailDomain.dmarc_suggestion && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Optional email security record</summary>
              <code className="mt-1 block font-mono break-all">{emailDomain.dmarc_suggestion}</code>
            </details>
          )}
          <form action={checkAction}>
            <Button type="submit" size="sm" variant="secondary" disabled={checkPending}>
              {checkPending ? 'Checking…' : 'Check setup'}
            </Button>
          </form>
          {(checkState as { error?: string } | null)?.error && (
            <p className="text-xs text-red-600">{(checkState as { error?: string }).error}</p>
          )}
        </div>
      )}

      {emailDomain?.status === 'verified' && (
        <div className="space-y-2">
          <ReadOnlyRow label="Connected domain" value={emailDomain.domain} />
          <div className="rounded-md border border-green-100 bg-green-50/60 p-3 space-y-1">
            <p className="text-xs font-medium text-green-800">Your support email is connected</p>
            <p className="text-xs text-green-700 break-all">
              Customers can email <code className="font-mono">support@{emailDomain.domain}</code>. Tickets will appear here,
              and replies will come from <code className="font-mono">noreply@{emailDomain.domain}</code>.
            </p>
          </div>
          <p className="text-xs text-gray-500 max-w-lg">
            Removing it deletes the domain from your email provider, not just from answerLoops, and
            cannot be undone — re-adding means verifying from scratch with new DNS records.
          </p>
          <Button
            size="sm"
            variant="danger"
            disabled={removePending}
            onClick={() => setShowRemoveDomainModal(true)}
          >
            Remove domain…
          </Button>
          {(removeState as { error?: string } | null)?.error && (
            <p className="text-xs text-red-600">{(removeState as { error?: string }).error}</p>
          )}
          {showRemoveDomainModal && (
            <RemoveDomainModal
              domain={emailDomain.domain}
              pending={removePending}
              error={(removeState as { error?: string } | null)?.error}
              onCancel={() => setShowRemoveDomainModal(false)}
              onConfirm={() => {
                // Left open while the action runs so the pending state and any
                // error stay visible; closed only once it has actually applied.
                startRemoveTransition(() => { removeAction(new FormData()) })
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

interface EmailOauthConnection {
  id: number
  mailbox_address: string
  provider: 'gmail' | 'outlook'
  status: 'connected' | 'disconnected'
}

const OAUTH_PROVIDER_LABEL: Record<EmailOauthConnection['provider'], string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
}

// "Connect a mailbox" section of EmailIntegrationCard (Phases 2/3 of the
// email integration redesign) — connect is a real page redirect to the
// provider's consent screen (app/api/email/gmail|outlook/install), not a
// form action; only disconnect fits the useActionState pattern. At most one
// OAuth mailbox connection can exist per org (Gmail or Outlook, not both —
// email_oauth_connections.orgId is unique), so this shows either connect
// buttons for both providers, or the single connected/disconnected state.
// Reads gmail_connected/gmail_error/outlook_connected/outlook_error query
// params on mount to surface the callback's result.
function EmailOauthSection({ onConnected }: { onConnected: () => void }) {
  const [connection, setConnection] = useState<EmailOauthConnection | null | undefined>(undefined)
  const searchParams = useSearchParams()
  const { toastMessage, showToast } = useToast()
  const [, startDisconnectTransition] = useTransition()

  async function reload() {
    const data: EmailOauthConnection | null = await fetch('/api/email-oauth').then((r) => r.json())
    setConnection(data)
    if (data?.status === 'connected') onConnected()
  }

  // Mount-only. `reload` is redeclared every render and closes over the
  // `onConnected` prop, which the parent does not memoize — adding either to the
  // dep array re-runs this fetch on every parent render rather than once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [])

  useEffect(() => {
    for (const provider of ['gmail', 'outlook'] as const) {
      const label = OAUTH_PROVIDER_LABEL[provider]
      if (searchParams.get(`${provider}_connected`)) showToast(`${label} connected`)
      const err = searchParams.get(`${provider}_error`)
      if (err) showToast(`${label} connect failed: ${err.slice(0, 60)}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const [disconnectState, disconnectAction, disconnectPending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await disconnectOauthAction(prev, fd)
      if (!result?.error) setConnection(null)
      return result
    },
    null
  )

  if (connection === undefined) return null

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-3">
      {toastMessage && <Toast message={toastMessage} />}
      <p className="text-xs font-medium text-gray-600">Connect a mailbox</p>
      <p className="text-xs text-gray-500">
        Choose the Gmail or Outlook mailbox that should send and receive support replies — not your personal login.
        It's the quick option, no DNS setup, but depends on the connection staying active. Only one mailbox can be
        connected at a time.
      </p>

      {connection === null && (
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/email/gmail/install">
            <Button type="button" size="sm">Connect Gmail</Button>
          </a>
          <a href="/api/email/outlook/install">
            <Button type="button" size="sm" variant="secondary">Connect Outlook</Button>
          </a>
        </div>
      )}

      {connection?.status === 'connected' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-green-700">Gmail is connected</p>
          <ReadOnlyRow label={`${OAUTH_PROVIDER_LABEL[connection.provider]} mailbox`} value={connection.mailbox_address} />
          <p className="text-xs text-gray-500">Replies will be sent from this mailbox.</p>
          <Button
            size="sm"
            variant="danger"
            disabled={disconnectPending}
            onClick={() => startDisconnectTransition(() => { disconnectAction(new FormData()) })}
          >
            {disconnectPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
          {(disconnectState as { error?: string } | null)?.error && (
            <p className="text-xs text-red-600">{(disconnectState as { error?: string }).error}</p>
          )}
        </div>
      )}

      {connection?.status === 'disconnected' && (
        <div className="space-y-2">
          <p className="text-xs text-red-600">
            {OAUTH_PROVIDER_LABEL[connection.provider]} connection to <span className="break-all">{connection.mailbox_address}</span> was
            lost — reconnect to resume sending from it.
          </p>
          <a href={`/api/email/${connection.provider}/install`}>
            <Button type="button" size="sm">Reconnect {OAUTH_PROVIDER_LABEL[connection.provider]}</Button>
          </a>
        </div>
      )}
    </div>
  )
}

function DnsRecordRow({
  label,
  name,
  value,
  copied,
  onCopy,
}: {
  label: string
  name: string
  value: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-500 break-all">{label} — <span className="font-mono">{name}</span></p>
      <div className="relative">
        <code className="block text-xs font-mono text-gray-900 bg-white border border-gray-200 rounded px-3 py-2 pr-16 break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="absolute top-2 right-2 rounded px-2 py-1 text-[0.625rem] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

type DeliveryMethod = 'domain' | 'mailbox'

/**
 * How inbound mail reaches answerLoops — asked once, as a choice.
 *
 * Only one delivery method is needed, but the choices used to be rendered as
 * stacked panels with no default and no indication of that. The tradeoff copy
 * was already good; it was the shape that made the screen a puzzle.
 *
 * So: pick one, then set that one up. The other stays one click away for
 * anyone who wants to switch, and the choice is remembered by what is actually
 * configured rather than by any stored preference — a verified domain or a
 * connected mailbox *is* the answer to "which method", so there is no separate
 * state that can disagree with reality.
 */
function EmailDeliverySection({
  configured,
  onChanged,
}: {
  configured: DeliveryMethod | null
  onChanged: () => void
}) {
  // Only meaningful before something is configured; once a domain is verified
  // or a mailbox connected, `configured` decides and this is ignored.
  const [picked, setPicked] = useState<DeliveryMethod | null>(null)
  const method = configured ?? picked

  if (method === null) {
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-3">
        <div>
          <p className="text-xs font-medium text-gray-600">How should mail reach answerLoops?</p>
          <p className="text-xs text-gray-500 mt-1">Pick one — you can change it later.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <MethodCard
            title="Use your own domain"
            badge="Recommended"
            body="Receive tickets at your own address and send replies from it. Add the DNS records once; no mailbox login is required."
            onSelect={() => setPicked('domain')}
          />
          <MethodCard
            title="Connect a mailbox"
            body="Gmail or Outlook, connected in a couple of clicks. No DNS, but it stops working if the connection lapses."
            onSelect={() => setPicked('mailbox')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {method === 'domain' && <EmailDomainSection onVerified={onChanged} />}
      {method === 'mailbox' && <EmailOauthSection onConnected={onChanged} />}

      {/* Offered only while nothing is actually set up. Once a domain is
          verified or a mailbox connected, that section owns its own removal
          flow — hiding it behind a method switch would strand the only way to
          undo it. */}
      {configured === null && (
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="-mx-2 inline-flex min-h-11 items-center rounded px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700"
        >
          ← Use a different method
        </button>
      )}
    </div>
  )
}

function MethodCard({
  title,
  body,
  badge,
  onSelect,
}: {
  title: string
  body: string
  badge?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
    >
      {/* Wraps rather than shrinks. In a one-third column at the sm
          breakpoint the badge stole enough width to break "Use your own
          domain" onto four lines — the flex row shrank the title instead of
          overflowing, so it measured as fitting while reading as broken. */}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-gray-900">{title}</span>
        {badge && (
          <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide text-blue-700">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-1 text-xs leading-relaxed text-gray-500">{body}</span>
    </button>
  )
}

export function EmailIntegrationCard() {
  const [integration, setIntegration] = useState<EmailIntegration | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  // Which delivery method is actually set up, as opposed to which one someone
  // clicked. Drives both the chooser's default and the status badge, because
  // "enabled" and "mail can actually arrive" are different questions and the
  // badge used to answer the first while appearing to answer the second.
  const [configuredMethod, setConfiguredMethod] = useState<DeliveryMethod | null>(null)
  const [configuredLive, setConfiguredLive] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveEmailIntegrationAction(prev, fd)
      if (result && !('error' in result && result.error)) {
        const updated = await fetch('/api/integrations').then((r) => r.json())
        setIntegration(updated.find((i: EmailIntegration) => i.platform === 'email') ?? null)
        setEditing(false)
        showToast('Email settings saved')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteEmailIntegrationAction(prev, fd)
      if (!result?.error) { setIntegration(null); setEditing(false) }
      return result
    },
    null
  )

  async function reloadIntegration() {
    const data: EmailIntegration[] = await fetch('/api/integrations').then((r) => r.json())
    setIntegration(data.find((i) => i.platform === 'email') ?? null)
  }

  // A verified domain or a live mailbox is the only evidence we have that mail
  // can reach us. The webhook path leaves no trace to check — a provider is
  // either posting to the endpoint or it is not — so it is deliberately not
  // inferred here rather than guessed at.
  async function reloadConfiguredMethod() {
    const [domain, oauth] = await Promise.all([
      fetch('/api/email-domain').then((r) => r.json()).catch(() => null),
      fetch('/api/email-oauth').then((r) => r.json()).catch(() => null),
    ])
    const domainLive = domain?.status === 'verified'
    const oauthLive = oauth?.status === 'connected'

    // A live method always wins so a stale row from an earlier setup attempt
    // can't hide a channel that's actually working. Only fall back to
    // whichever row merely exists when neither is live.
    if (domainLive) {
      setConfiguredMethod('domain')
      setConfiguredLive(true)
    } else if (oauthLive) {
      setConfiguredMethod('mailbox')
      setConfiguredLive(true)
    } else if (domain) {
      setConfiguredMethod('domain')
      setConfiguredLive(false)
    } else if (oauth) {
      setConfiguredMethod('mailbox')
      setConfiguredLive(false)
    } else {
      setConfiguredMethod(null)
      setConfiguredLive(false)
    }
  }

  useEffect(() => { reloadIntegration(); reloadConfiguredMethod() }, [])

  if (integration === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = integration !== null && integration.enabled === 1
  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 shrink-0 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-sm font-bold">@</div>
            <div>
              <p className="text-sm font-medium text-gray-900">Email</p>
              <p className="text-xs text-gray-500">
                {!connected ? 'Not connected' : configuredLive ? 'Connected' : 'Setup incomplete'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Enabling the channel is not the same as mail being able to
                arrive. This read Active the moment the row existed, with no
                domain verified and no mailbox connected — claiming a working
                integration for one that could receive nothing. The webhook
                path leaves no trace to check, so it stays pending until a
                delivery method is provably in place. */}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                !connected ? 'bg-gray-100 text-gray-500'
                : configuredLive ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {!connected ? 'Inactive' : configuredLive ? 'Active' : 'Needs setup'}
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

        {connected && (
          <EmailDeliverySection
            configured={configuredMethod}
            onChanged={() => { reloadIntegration(); reloadConfiguredMethod() }}
          />
        )}

        {connected && !editing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Allowed senders" value={integration.channel_ids.join(', ') || '— (all senders)'} />
            {integration.escalation_role_id && (
              <ReadOnlyRow label="Escalation email" value={integration.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration.auto_deflect_enabled === 1} />
            </div>
          </div>
        )}

        {connected && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit sender filters &amp; deflections
          </Button>
        )}


        {/* Enabling the channel and tuning it are separate jobs, and mixing
            them put three optional fields in front of the only button that
            does anything. Sender filters, threshold and deflections are
            meaningless until mail has somewhere to arrive from, so on the way
            in this is a single action and those fields live where they already
            had an editor — "Edit sender filters & deflections", below. */}
        {!connected && (
          <form action={saveAction} className="space-y-3">
            <p className="text-xs text-gray-500">
              Turn on the email channel, then choose your company domain for inbound tickets or connect Gmail or
              Outlook for outbound replies. Sender filters and deflection settings come after.
            </p>
            <Button type="submit" disabled={savePending}>
              {savePending ? 'Setting up…' : 'Set up email'}
            </Button>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
          </form>
        )}

        {editing && (
          <form key="edit" action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Allowed sender addresses/domains <span className="text-gray-400 font-normal">(optional — leave blank to accept all)</span>
              </label>
              <input
                name="allowedSenders"
                type="text"
                defaultValue={integration?.channel_ids.join(', ') ?? ''}
                placeholder="example.com, partner@other.com"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Accepts full email addresses or domains. Filters out noise from unknown senders.</p>
            </div>
            <hr className="border-gray-100" />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Escalation email <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                name="escalationEmail"
                type="email"
                defaultValue={integration?.escalation_role_id ?? ''}
                placeholder="team@yourcompany.com"
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Referenced in replies when AI confidence is below threshold.</p>
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
            <div>
              <ToggleSwitch
                name="autoDeflectEnabled"
                label="Automatic Deflections"
                confirmLabel="Email"
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

// Google Chat has no OAuth "add to workspace" flow like Slack/Discord —
// connecting is: generate a code here, a Workspace admin adds the app to a
// Chat space, then posts `/connect <code>` in that space. See
// app/actions/integrations.ts's generateGoogleChatConnectCodeAction and
// app/api/google-chat/events/route.ts's pairing handler.
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

function TransferOwnershipModal({
  target,
  onConfirm,
  onCancel,
  pending,
}: {
  target: Member
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 mx-4">
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Transfer Ownership</h2>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          You are about to transfer ownership of this workspace to{' '}
          <span className="font-medium text-gray-900">{target.name ?? target.email}</span>.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          You will become a regular member and lose owner privileges. This cannot be undone unless the new owner transfers it back.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 transition-colors"
          >
            {pending ? 'Transferring…' : 'Yes, transfer ownership'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function TeamSection() {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [transferTarget, setTransferTarget] = useState<Member | null>(null)
  const [transferPending, setTransferPending] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session').then((r) => r.json()).then((s) => {
      if (s?.user?.id) setCurrentUserId(Number(s.user.id))
    })
  }, [])

  const [inviteCopied, setInviteCopied] = useState(false)

  const [inviteState, inviteFormAction, invitePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await sendInviteAction(prev, fd)
      if (!result?.error && result?.inviteUrl) {
        await navigator.clipboard.writeText(result.inviteUrl).catch(() => {})
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 4000)
        await reload()
      }
      return result
    },
    null
  )

  const reload = async () => {
    const [m, i] = await Promise.all([
      fetch('/api/team/members').then((r) => r.json()),
      fetch('/api/team/invites').then((r) => r.json()),
    ])
    setMembers(m)
    setInvites(i)
  }

  useEffect(() => { reload() }, [])

  // Live-update when a team member accepts an invite — no polling needed.
  // This rides the tab's shared SSE stream rather than opening a second one:
  // the dashboard layout already mounts DashboardLive, and each stream costs
  // a dedicated Postgres LISTEN connection. `resync` means the stream was
  // rebuilt (tab refocused, or the connection went stale) and a
  // member_joined may have been missed while it was down — the member and
  // invite lists are client state that a router.refresh() would not
  // repopulate, so refetch them here.
  useEffect(() => subscribeLiveEvents(['member_joined', 'resync'], () => { reload() }), [])

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Current members */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold text-gray-600">Members</p>
        </div>
        {members.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No members yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => {
              const isCurrentUser = m.user_id === currentUserId
              const isOwner = m.role === 'owner'
              const viewerIsOwner = members.find((x) => x.user_id === currentUserId)?.role === 'owner'
              const hasOtherMembers = members.length > 1

              return (
                <li key={m.membership_id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{m.name ?? m.email ?? 'Unknown'}</p>
                    <p className="text-xs text-gray-400">{m.email} · <span className="capitalize">{m.role}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    {viewerIsOwner && !isCurrentUser && !isOwner && hasOtherMembers && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-brand-600 hover:text-brand-800"
                        onClick={() => setTransferTarget(m)}
                      >
                        Transfer Ownership
                      </Button>
                    )}
                    {!isOwner && (
                      <form action={async (fd) => { await removeMemberAction(null, fd); await reload() }}>
                        <input type="hidden" name="membershipId" value={m.membership_id} />
                        <input type="hidden" name="userId" value={m.user_id} />
                        <Button type="submit" size="sm" variant="ghost">Remove</Button>
                      </form>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-600">Pending Invites</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{inv.email}</p>
                  <p className="text-xs text-gray-400">
                    <span className="capitalize">{inv.role}</span> · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => copyLink(inv.token)}
                  >
                    {copiedToken === inv.token ? 'Copied!' : 'Copy link'}
                  </Button>
                  <form action={async (fd) => { await revokeInviteAction(null, fd); await reload() }}>
                    <input type="hidden" name="id" value={inv.id} />
                    <Button type="submit" size="sm" variant="ghost">Revoke</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Invite form */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">Invite a teammate</p>
        <form action={inviteFormAction} className="flex gap-2 flex-wrap">
          <input
            name="email"
            type="email"
            placeholder="colleague@example.com"
            required
            className="flex-1 min-w-0 rounded border border-gray-200 px-3 py-1.5 text-sm"
          />
          <select name="role" className="rounded border border-gray-200 px-2 py-1.5 text-sm bg-white">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" size="sm" disabled={invitePending}>
            {invitePending ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
        {(inviteState as { error?: string } | null)?.error && (
          <p className="mt-2 text-xs text-red-600">{(inviteState as { error?: string }).error}</p>
        )}
        {inviteCopied && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <svg className="h-4 w-4 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <p className="text-xs text-green-700 font-medium">Invite link copied to clipboard — send it to your teammate.</p>
          </div>
        )}
      </div>

      {transferTarget && (
        <TransferOwnershipModal
          target={transferTarget}
          pending={transferPending}
          onCancel={() => setTransferTarget(null)}
          onConfirm={async () => {
            setTransferPending(true)
            const fd = new FormData()
            fd.set('membershipId', String(transferTarget.membership_id))
            fd.set('userId', String(transferTarget.user_id))
            await transferOwnershipAction(null, fd)
            setTransferPending(false)
            setTransferTarget(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

const CHAT_PROVIDERS = [
  {
    value: 'openai',
    label: 'OpenAI',
    placeholder: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o3-mini', 'o4-mini'],
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    placeholder: 'claude-sonnet-4-6',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-fable-5'],
  },
  {
    value: 'google',
    label: 'Google Gemini',
    placeholder: 'gemini-2.0-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
  },
  {
    value: 'groq',
    label: 'Groq',
    placeholder: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
  },
  {
    value: 'mistral',
    label: 'Mistral',
    placeholder: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mixtral-8x22b'],
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio, vLLM…)',
    placeholder: 'llama3.2',
    models: [] as string[],
  },
]

const EMBEDDING_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (Ollama, local)' },
] as const

interface AIConfig {
  chat_provider: string
  chat_model: string
  chat_api_key_set: boolean
  chat_base_url: string | null
  embedding_provider: string
  embedding_model: string
  embedding_api_key_set: boolean
  embedding_base_url: string | null
}

export function AIModelSection() {
  const [config, setConfig] = useState<AIConfig | null | undefined>(undefined)
  const [chatProvider, setChatProvider] = useState('openai')
  const [embeddingProvider, setEmbeddingProvider] = useState('openai')
  const [editing, setEditing] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startClearTransition] = useTransition()
  const [trialStatus, setTrialStatus] = useState<{ used: number; limit: number; remaining: number; exhausted: boolean } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [testing, startTest] = useTransition()
  const [testResult, setTestResult] = useState<AIConnectionResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  function runTest() {
    if (!formRef.current) return
    setTestResult(null)
    setTestError(null)
    const fd = new FormData(formRef.current)
    startTest(async () => {
      const res = await testAIConfigAction(null, fd)
      if (res.error) setTestError(res.error)
      else if (res.result) setTestResult(res.result)
    })
  }

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveAIConfigAction(prev, fd)
      if (!result?.error) {
        const updated = await fetch('/api/ai-config').then((r) => r.json())
        setConfig(updated)
        if (updated) {
          setChatProvider(updated.chat_provider)
          setEmbeddingProvider(updated.embedding_provider)
        }
        setEditing(false)
        showToast('AI model settings updated')
      }
      return result
    },
    null
  )

  const [clearState, clearAction, clearPending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await clearAIConfigAction(prev, fd)
      if (!result?.error) {
        setConfig(null)
        setEditing(false)
        fetch('/api/ai-config/trial-status').then((r) => r.json()).then(setTrialStatus)
      }
      return result
    },
    null
  )

  useEffect(() => {
    fetch('/api/ai-config')
      .then((r) => r.json())
      .then((data: AIConfig | null) => {
        setConfig(data)
        if (data) {
          setChatProvider(data.chat_provider)
          setEmbeddingProvider(data.embedding_provider)
        }
      })
    fetch('/api/ai-config/trial-status')
      .then((r) => r.json())
      .then(setTrialStatus)
  }, [])

  if (config === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const configured = config !== null
  const chatMeta = CHAT_PROVIDERS.find((p) => p.value === chatProvider) ?? CHAT_PROVIDERS[0]
  const needsEmbedKey = chatProvider !== 'openai' || embeddingProvider === 'openai-compatible'
  const showForm = !configured || editing

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">AI Model</p>
            <p className="text-xs text-gray-500">
              {configured
                ? `${chatMeta.label} · ${config.chat_model}`
                : trialStatus
                  ? trialStatus.exhausted
                    ? 'Free AI trial used up — add a key to keep AI features running'
                    : `Using answerLoops' key — ${trialStatus.remaining} of ${trialStatus.limit} free AI-answered tickets left`
                  : 'Using platform default (OPENAI_API_KEY from environment)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${configured ? 'bg-brand-100 text-brand-700' : trialStatus?.exhausted ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
              {configured ? 'Custom' : trialStatus?.exhausted ? 'Trial used up' : trialStatus ? 'Free trial' : 'Platform default'}
            </span>
            {configured && !editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </div>

        {/* Locked summary */}
        {configured && !editing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Chat provider" value={chatMeta.label} />
            <ReadOnlyRow label="Model" value={config.chat_model} />
            <ReadOnlyRow label="Chat API key" value={config.chat_api_key_set ? '••••••••• (saved)' : 'Not set'} />
            {config.chat_base_url && <ReadOnlyRow label="Base URL" value={config.chat_base_url} />}
            <ReadOnlyRow label="Embedding provider" value={EMBEDDING_PROVIDERS.find(p => p.value === config.embedding_provider)?.label ?? config.embedding_provider} />
            <ReadOnlyRow label="Embedding model" value={config.embedding_model} />
            {config.embedding_api_key_set && <ReadOnlyRow label="Embedding API key" value="••••••••• (saved)" />}
          </div>
        )}

        {/* Edit form */}
        {showForm && (
          <form ref={formRef} key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Chat provider</label>
              <select
                name="chat_provider"
                value={chatProvider}
                onChange={(e) => setChatProvider(e.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm bg-white"
              >
                {CHAT_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Model ID</label>
              <input
                name="chat_model"
                type="text"
                list="chat-model-suggestions"
                defaultValue={config?.chat_model ?? ''}
                placeholder={chatMeta.placeholder}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                required
              />
              {chatMeta.models.length > 0 && (
                <datalist id="chat-model-suggestions">
                  {chatMeta.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="block text-xs font-medium text-gray-600">API key</label>
                {configured && config.chat_api_key_set
                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Key saved
                    </span>
                  : <span className="text-xs text-amber-600 font-medium">No key saved</span>
                }
              </div>
              <input
                name="chat_api_key"
                type="password"
                autoComplete="new-password"
                placeholder={configured && config.chat_api_key_set ? 'Leave blank to keep current key' : 'sk-…'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              {chatProvider === 'openai-compatible' && (
                <p className="text-xs text-gray-400 mt-1">Leave blank for local endpoints that don't require auth.</p>
              )}
            </div>

            {chatProvider === 'openai-compatible' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
                <input
                  name="chat_base_url"
                  type="url"
                  defaultValue={config?.chat_base_url ?? ''}
                  placeholder="http://localhost:11434/v1"
                  className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">Ollama: <code>http://localhost:11434/v1</code> · LM Studio: <code>http://localhost:1234/v1</code></p>
              </div>
            )}

            <hr className="border-gray-100" />

            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Embeddings</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Embedding provider</label>
                  <select
                    name="embedding_provider"
                    value={embeddingProvider}
                    onChange={(e) => setEmbeddingProvider(e.target.value)}
                    className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm bg-white"
                  >
                    {EMBEDDING_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Embedding model</label>
                  <input
                    name="embedding_model"
                    type="text"
                    defaultValue={config?.embedding_model ?? 'text-embedding-3-small'}
                    placeholder={embeddingProvider === 'openai-compatible' ? 'nomic-embed-text' : 'text-embedding-3-small'}
                    className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    required
                  />
                </div>

                {needsEmbedKey && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-xs font-medium text-gray-600">
                        Embedding API key{chatProvider === 'openai' ? '' : ' (OpenAI key for embeddings)'}
                      </label>
                      {configured && config.embedding_api_key_set
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            Key saved
                          </span>
                        : <span className="text-xs text-amber-600 font-medium">No key saved</span>
                      }
                    </div>
                    <input
                      name="embedding_api_key"
                      type="password"
                      autoComplete="new-password"
                      placeholder={configured && config.embedding_api_key_set ? 'Leave blank to keep current key' : 'sk-…'}
                      className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                )}

                {embeddingProvider === 'openai-compatible' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Embedding base URL</label>
                    <input
                      name="embedding_base_url"
                      type="url"
                      defaultValue={config?.embedding_base_url ?? ''}
                      placeholder="http://localhost:11434/v1"
                      className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            {(clearState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(clearState as { error?: string }).error}</p>
            )}
            {testError && <p className="text-xs text-red-600">{testError}</p>}
            {testResult && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs space-y-1">
                {(['chat', 'embedding'] as const).map((k) => {
                  const check = testResult[k]
                  return (
                    <p key={k} className={check.ok ? 'text-green-700' : 'text-red-600'}>
                      <span className="font-medium capitalize">{k}:</span>{' '}
                      {check.ok ? 'connection OK' : (check.error ?? 'failed')}
                    </p>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : configured ? 'Update' : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={runTest} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              {configured && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={clearPending}
                  onClick={() => startClearTransition(() => { clearAction(new FormData()) })}
                >
                  {clearPending ? 'Clearing…' : 'Reset to platform default'}
                </Button>
              )}
            </div>
          </form>
        )}

        {!configured && (
          <p className="text-xs text-gray-400">
            No custom config — all AI calls use the platform <code>OPENAI_API_KEY</code> env var.
          </p>
        )}
      </div>
    </>
  )
}

function WidgetSection() {
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rotating, setRotating] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  // Server actions are the authoritative gate; this only decides whether to
  // render controls a member would be rejected for using. Defaults to false so
  // they never flash in before the role is known.
  const [canManage, setCanManage] = useState(false)
  const [origins, setOrigins] = useState('')
  const [savedOrigins, setSavedOrigins] = useState('')
  const [savingOrigins, setSavingOrigins] = useState(false)
  const [originsMsg, setOriginsMsg] = useState<string | null>(null)

  async function loadToken() {
    setLoading(true)
    const result = await getWidgetTokenAction()
    if (result.token) {
      setToken(result.token)
      setExpiresAt(result.expiresAt ?? null)
      setCanManage(result.canManage === true)
      setOrigins(result.allowedOrigins ?? '')
      setSavedOrigins(result.allowedOrigins ?? '')
    }
    setLoading(false)
  }

  async function saveOrigins() {
    setSavingOrigins(true)
    setOriginsMsg(null)
    const fd = new FormData()
    fd.set('origins', origins)
    const result = await saveWidgetOriginsAction(null, fd)
    if (result.error) {
      setOriginsMsg(result.error)
    } else {
      const normalized = (result.origins ?? []).join('\n')
      setOrigins(normalized)
      setSavedOrigins(normalized)
      setOriginsMsg(
        normalized
          ? `Saved. The widget will load on ${result.origins!.length} domain${result.origins!.length === 1 ? '' : 's'}.`
          : 'Saved. With no domains listed the widget will not load on any site.'
      )
    }
    setSavingOrigins(false)
  }

  useEffect(() => { loadToken() }, [])

  async function regenerate() {
    setRotating(true)
    setConfirmRotate(false)
    const result = await regenerateWidgetTokenAction()
    if (result.token) { setToken(result.token); setExpiresAt(result.expiresAt ?? null) }
    setRotating(false)
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const embedCode = token
    ? `<script src="${baseUrl}/widget.js" data-widget-id="${token}"></script>`
    : ''

  const daysLeft = expiresAt
    ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
    : null

  const expiringSoon = daysLeft !== null && daysLeft <= 14

  function copyEmbed() {
    if (!embedCode) return
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <p className="text-xs text-gray-600">
        Add a chat widget to any website. Visitors can ask questions and get answers from your knowledge base automatically.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !token ? (
        <p className="text-sm text-red-500">Failed to load widget token.</p>
      ) : (
        <div className="space-y-3">
          {expiringSoon && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-800 font-medium">
                Token expires in {daysLeft} day{daysLeft === 1 ? '' : 's'} — regenerate it before it expires or the widget will stop working.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Paste this before <code className="text-brand-600">&lt;/body&gt;</code></p>
            <div className="relative">
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 font-mono overflow-x-auto whitespace-pre-wrap break-all">{embedCode}</pre>
              <button
                onClick={copyEmbed}
                className="absolute top-2 right-2 rounded px-2 py-1 text-[0.625rem] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <a
                href={`/widget/${token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
              >
                Preview widget ↗
              </a>
              {expiresAt && (
                <p className={`text-[0.625rem] ${expiringSoon ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                  Expires {new Date(expiresAt).toLocaleDateString()} ({daysLeft}d left)
                </p>
              )}
            </div>

            {!canManage ? null : confirmRotate ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-red-600">Old token breaks immediately.</p>
                <Button size="sm" variant="danger" onClick={regenerate} disabled={rotating}>
                  {rotating ? 'Rotating…' : 'Confirm rotate'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmRotate(true)} disabled={rotating}>
                Regenerate token
              </Button>
            )}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <div>
              <p className="text-xs font-medium text-gray-900">Allowed domains</p>
              <p className="text-[0.6875rem] text-gray-500">
                The embed token is visible in your page source, so anyone can copy it. List the domains
                you embed on — the widget will not load anywhere else. Subdomains are included. Your
                answerLoops domain is always allowed, so the preview link works without setup.
              </p>
            </div>
            {canManage ? (
              <>
                <textarea
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={'example.com\ndocs.example.com'}
                  className="w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={saveOrigins} disabled={savingOrigins || origins === savedOrigins}>
                    {savingOrigins ? 'Saving…' : 'Save domains'}
                  </Button>
                  {originsMsg && <p className="text-[0.6875rem] text-gray-600">{originsMsg}</p>}
                </div>
              </>
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600">
                {savedOrigins
                  ? `Allowed on: ${savedOrigins.split('\n').join(', ')}`
                  : 'No domains listed — the widget will not load on any site yet.'}
                {' '}Only owners and admins can change this.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface ApiKeyRow {
  id: number
  name: string
  key_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null)
  // Whether this member may mint/revoke keys. The server action is the
  // authoritative gate — this only decides whether to render controls that
  // would be rejected anyway. Defaults to false so the controls never flash
  // in before the role is known.
  const [canManage, setCanManage] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const loadKeys = useCallback(async () => {
    const res = await fetch('/api/api-keys')
    if (!res.ok) return
    const data = await res.json()
    setKeys(data.keys)
    setCanManage(data.can_manage === true)
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const [createState, createAction, creating] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await createApiKeyAction(prev, fd)
      if (result && !result.error) {
        setNewKeyName('')
        if (result.plaintextKey) setPlaintextKey(result.plaintextKey)
        await loadKeys()
      }
      return result
    },
    null
  )

  function revoke(keyId: number) {
    setConfirmRevoke(null)
    setRevokeError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('keyId', String(keyId))
        const result = await revokeApiKeyAction(null, fd)
        if (result?.error) {
          setRevokeError(result.error)
          return
        }
        setKeys((current) => current?.filter((key) => key.id !== keyId) ?? current)
        setPlaintextKey(null)
      } catch {
        setRevokeError('Could not revoke this key. Please try again.')
        await loadKeys()
      }
    })
  }

  function copyKey() {
    if (!plaintextKey) return
    navigator.clipboard.writeText(plaintextKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const mcpConfig = `{
  "mcpServers": {
    "answerloops": {
      "url": "${baseUrl}/api/mcp",
      "headers": { "Authorization": "Bearer ${plaintextKey ?? 'al_live_xxxx'}" }
    }
  }
}`

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <p className="text-xs text-gray-600">
          API keys let AI agents (Claude Code, Cursor, or any MCP-compatible client) call answerLoops directly —
          searching your knowledge base, checking tickets, and answering questions using your community&apos;s data,
          scoped to this org. See <a href="/docs/integrations/mcp" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">the MCP docs</a> for setup.
        </p>

        {!canManage && (
          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Only workspace owners and admins can create or revoke API keys. Ask an owner if you need one.
          </p>
        )}

        {canManage && (
        <form action={createAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              name="name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Claude Code (laptop)"
              className="w-full min-w-0 flex-1 rounded border border-gray-200 px-3 py-1.5 text-sm"
              maxLength={100}
            />
            <select
              name="expiresInDays"
              defaultValue=""
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 sm:w-auto"
              title="Expiry"
            >
              <option value="">Never expires</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
            <div className="w-full sm:w-auto">
              <Button type="submit" size="sm" disabled={creating || !newKeyName.trim()} className="w-full sm:w-auto">
                {creating ? 'Creating…' : 'Create key'}
              </Button>
            </div>
          </div>
          <fieldset className="rounded-md border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600">
              Permissions — the key can only do what you check here
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {ALL_SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope}
                    defaultChecked
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <code className="text-[0.6875rem] text-gray-900">{scope}</code>
                    <span className="block text-gray-500">{API_SCOPES[scope]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </form>
        )}
        {createState?.error && <p className="text-xs text-red-600">{createState.error}</p>}

        {plaintextKey && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800">Copy this now — it won&apos;t be shown again.</p>
            <div className="relative">
              <code className="block text-xs font-mono text-amber-900 bg-white border border-amber-200 rounded px-3 py-2 pr-16 break-all select-all">
                {plaintextKey}
              </code>
              <button
                type="button"
                onClick={copyKey}
                className="absolute top-2 right-2 rounded px-2 py-1 text-[0.625rem] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs font-medium text-amber-800 pt-1">Drop this in your MCP client config:</p>
            <pre className="bg-gray-950 text-emerald-400 rounded-lg p-3 text-[0.6875rem] font-mono overflow-x-auto whitespace-pre">{mcpConfig}</pre>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {keys === null ? (
          <p className="text-sm text-gray-400 p-4">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">No API keys yet.</p>
        ) : (
          keys.map((k) => {
            const expired = !!k.expires_at && new Date(k.expires_at) < new Date()
            return (
              <div key={k.id} className={`flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${expired ? 'opacity-50' : ''}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{k.name}</p>
                  <p className="break-all text-xs font-mono text-gray-400">
                    {k.key_prefix}••••••••
                    {expired ? ' · expired' : k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}
                    {!expired && k.expires_at ? ` · expires ${new Date(k.expires_at).toLocaleDateString()}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {!k.scopes || k.scopes.length >= ALL_SCOPES.length
                      ? 'Full access'
                      : k.scopes.join(', ')}
                  </p>
                </div>
                {!canManage ? null : confirmRevoke === k.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="danger" onClick={() => revoke(k.id)}>Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(k.id)}>Revoke</Button>
                )}
              </div>
            )
          })
        )}
      </div>
      {revokeError && <p role="alert" className="text-xs text-red-600">{revokeError}</p>}
    </div>
  )
}

export function NotionIntegrationCard() {
  const [connection, setConnection] = useState<NotionConnection | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startDeleteTransition] = useTransition()
  const router = useRouter()

  const reload = useCallback(async () => {
    const data = await fetch('/api/notion').then((r) => r.json()).catch(() => ({ connection: null }))
    setConnection(data.connection ?? null)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveNotionConnectionAction(prev, fd)
      if (!result?.error) {
        await reload()
        setEditing(false)
        showToast('Notion connected')
        router.refresh()
      }
      return result
    },
    null
  )

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await deleteNotionConnectionAction(prev, fd)
      if (!result?.error) { setConnection(null); setEditing(false) }
      return result
    },
    null
  )

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/notion/sync-kb')
      const data = await res.json() as { synced?: number; truncated?: boolean; error?: string }
      if (data.error) {
        showToast(data.error)
      } else {
        showToast(
          `Synced ${data.synced ?? 0} chunk${data.synced === 1 ? '' : 's'}${data.truncated ? ' — knowledge base is full, some content was skipped' : ''}`
        )
        await reload()
      }
    } catch {
      showToast('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  if (connection === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const connected = connection !== null
  const showForm = !connected || editing

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-full bg-neutral-900 flex items-center justify-center text-white text-sm font-bold">N</div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Notion</p>
              <p className="text-xs text-gray-500 truncate">
                {connected
                  ? `Connected${connection.workspace_name ? ` · ${connection.workspace_name}` : ''}`
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
                Replace token
              </Button>
            )}
          </div>
        </div>

        {connected && !editing && (
          <>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
              <ReadOnlyRow label="Workspace" value={connection.workspace_name ?? '—'} />
              <ReadOnlyRow label="Token" value="••••••••• (saved)" />
              <ReadOnlyRow label="Last synced" value={connection.kb_last_synced ? new Date(connection.kb_last_synced).toLocaleString() : 'Never'} />
              <ReadOnlyRow label="Chunks" value={String(connection.kb_chunk_count)} />
            </div>
            <div className="rounded-md bg-neutral-50 border border-neutral-200 p-3 space-y-2">
              <p className="text-xs text-neutral-600">
                Share the Notion pages and databases you want synced with your integration, then run a sync. Imported content stays unpublished until you publish it on the Knowledge Base page.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={syncing} onClick={handleSync}>
                  {syncing ? 'Syncing…' : 'Sync now'}
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
            </div>
          </>
        )}

        {showForm && (
          <form key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Internal integration token</label>
              <input
                name="token"
                type="password"
                autoComplete="new-password"
                placeholder={connected ? '••••••••• (leave blank to keep current)' : 'ntn_… or secret_…'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                In Notion: <span className="font-medium">Settings → Connections → Develop or manage integrations</span> → create an internal integration → copy its <span className="font-medium">Internal Integration Secret</span>. Then open each page or database you want synced, <span className="font-medium">•••  → Connections</span>, and add the integration. answerLoops syncs everything the integration can see.
              </p>
            </div>
            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : connected ? 'Update' : 'Connect'}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
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

function GitHubIntegrationCard() {
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

function RemoveDomainModal({
  domain,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  domain: string
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
  error?: string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [confirmName, setConfirmName] = useState('')

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-domain-title"
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-xl p-6 mx-4"
      >
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
            <svg className="h-5 w-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          {/* A domain is one unbreakable token, so it needs min-w-0 + break-all
              to wrap instead of forcing the dialog wider than the viewport. */}
          <h2 id="remove-domain-title" className="min-w-0 break-all text-base font-semibold text-gray-900">Remove {domain}</h2>
        </div>
        <p className="mt-3 break-all text-sm text-gray-600">
          This deletes the domain from your email provider, not just from answerLoops. Its DKIM and
          return-path records stop being recognised, and replies immediately fall back to the
          platform-hosted sending address instead of <code className="font-mono">noreply@{domain}</code>.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          <span className="font-semibold text-gray-900">This cannot be undone.</span> Adding the domain
          back means verifying it from scratch — new DNS records at your registrar, and waiting for them
          to propagate before replies can send from it again.
        </p>
        <p className="mt-3 break-all text-sm text-gray-600">
          Type <span className="font-semibold text-gray-900">{domain}</span> to confirm.
        </p>
        <input
          type="text"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={domain}
          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-red-400 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <button
            onClick={onConfirm}
            disabled={pending || confirmName.trim() !== domain}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Removing…' : 'Remove domain'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteAccountModal({
  orgName,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  orgName: string
  onConfirm: (confirmName: string) => void
  onCancel: () => void
  pending: boolean
  error?: string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [confirmName, setConfirmName] = useState('')

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 mx-4">
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg className="h-5 w-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Delete workspace</h2>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          This cancels billing and revokes access immediately. Your data (tickets, knowledge base,
          integrations, API keys) is kept for 30 days in case this was a mistake, then permanently deleted.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          Type <span className="font-semibold text-gray-900">{orgName}</span> to confirm.
        </p>
        <input
          type="text"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={orgName}
          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-red-400 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <button
            onClick={() => onConfirm(confirmName)}
            disabled={pending || confirmName.trim() !== orgName}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DangerZoneSection() {
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [orgName, setOrgName] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    fetch('/api/auth/session').then((r) => r.json()).then((s) => {
      if (s?.user?.id) setCurrentUserId(Number(s.user.id))
    })
    fetch('/api/team/members').then((r) => r.json()).then(setMembers).catch(() => {})
    getCurrentOrgName().then(setOrgName)
  }, [])

  const isOwner = members.find((m) => m.user_id === currentUserId)?.role === 'owner'

  async function handleConfirm(confirmName: string) {
    setPending(true)
    setError(undefined)
    const fd = new FormData()
    fd.set('confirmName', confirmName)
    const result = await deleteAccountAction(null, fd)
    if (result?.error) {
      setError(result.error)
      setPending(false)
      return
    }
    // deleteAccountAction signs the user out and redirects on success —
    // if we're still here, the browser will follow shortly.
  }

  if (!isOwner) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm text-gray-500">Only the workspace owner can delete this account.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-red-200 p-5">
      <p className="text-sm font-medium text-gray-900">Delete this workspace</p>
      <p className="text-xs text-gray-500 mt-1 max-w-lg">
        Permanently deletes {orgName ?? 'this workspace'} — billing, integrations, tickets, and knowledge
        base. Access is revoked immediately; data is kept for 30 days in case you change your mind.
      </p>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
      >
        Delete workspace…
      </button>

      {showModal && orgName && (
        <DeleteAccountModal
          orgName={orgName}
          pending={pending}
          error={error}
          onCancel={() => { setShowModal(false); setError(undefined) }}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}

const TABS = [
  { id: 'general',   label: 'General' },
  { id: 'team',      label: 'Team' },
  { id: 'discord',   label: 'Discord' },
  { id: 'slack',     label: 'Slack' },
  { id: 'google-chat', label: 'Google Chat' },
  { id: 'telegram',  label: 'Telegram' },
  { id: 'discourse', label: 'Discourse' },
  { id: 'circle',    label: 'Circle' },
  { id: 'email',     label: 'Email' },
  { id: 'github',    label: 'GitHub' },
  { id: 'notion',    label: 'Notion' },
  { id: 'ai',        label: 'AI Model' },
  { id: 'widget',    label: 'Widget' },
  { id: 'api-keys',  label: 'API Keys' },
  { id: 'danger',    label: 'Danger Zone' },
] as const

type TabId = (typeof TABS)[number]['id']

// Maps a tab id to the `platform` value stored on the integrations table —
// these diverge for Google Chat (tab id uses a hyphen, the DB value uses an
// underscore). GitHub isn't here: its deflection state is per-repo, not a
// single integrations-table row, so it's fetched separately.
const TAB_PLATFORM: Partial<Record<TabId, string>> = {
  discord: 'discord',
  slack: 'slack',
  'google-chat': 'google_chat',
  telegram: 'telegram',
  discourse: 'discourse',
  email: 'email',
}

// Per-tab dot state for the Automatic Deflections indicator in the tab bar:
// null = not connected / no data yet (no dot), true = at least one enabled,
// false = connected but none enabled.
type DeflectionDotState = Record<string, boolean | null>

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[]>([])
  const [deflectionDots, setDeflectionDots] = useState<DeflectionDotState>({})

  const activeTab = (searchParams.get('tab') as TabId) ?? 'general'

  const setTab = (id: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', id)
    router.replace(`/settings?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    setSlaConfigs([
      { id: 1, priority: 'critical', response_hours: 1, resolve_hours: 4, updated_at: '' },
      { id: 2, priority: 'high', response_hours: 4, resolve_hours: 24, updated_at: '' },
      { id: 3, priority: 'medium', response_hours: 24, resolve_hours: 72, updated_at: '' },
      { id: 4, priority: 'low', response_hours: 72, resolve_hours: 168, updated_at: '' },
    ])
  }, [])

  // One-time fetch (not per-card) so the tab bar can show each platform's
  // Automatic Deflections state before the user ever clicks into that tab.
  useEffect(() => {
    fetch('/api/integrations')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: { platform: string; enabled: number; team_id: string | null; auto_deflect_enabled: number }[]) => {
        setDeflectionDots((prev) => {
          const next = { ...prev }
          for (const [tabId, platform] of Object.entries(TAB_PLATFORM)) {
            const row = rows.find((r) => r.platform === platform)
            // A row can exist (e.g. a partially-set-up Google Chat pairing)
            // without the integration actually being connected — match each
            // card's own `connected` check (enabled === 1, plus team_id for
            // Google Chat) rather than just "a row exists for this platform."
            const isConnected = row != null && row.enabled === 1 && ((platform !== 'google_chat' && platform !== 'discourse') || !!row.team_id)
            next[tabId] = isConnected ? row.auto_deflect_enabled === 1 : null
          }
          return next
        })
      })
      .catch(() => {})

    fetch('/api/github/repos')
      .then((res) => (res.ok ? res.json() : []))
      .then((repos: { auto_deflect_enabled: number }[]) => {
        setDeflectionDots((prev) => ({
          ...prev,
          github: repos.length === 0 ? null : repos.some((r) => r.auto_deflect_enabled === 1),
        }))
      })
      .catch(() => {})
  }, [])

  return (
    <div className="dashboard-page max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-600">
          <span className="h-px w-5 bg-blue-500" />
          Workspace configuration
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage integrations, AI behavior, team access, and customer-facing channels.</p>
      </div>

      {/* Tab bar */}
      <div className="mb-7 flex min-w-0 gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-sm">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={[
              'shrink-0 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'bg-[#252525] text-white shadow-md'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            <span className="inline-flex items-center gap-1.5">
              {tab.label}
              {deflectionDots[tab.id] != null && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${deflectionDots[tab.id] ? 'bg-emerald-500' : 'bg-red-500'}`}
                  title={`Automatic Deflections: ${deflectionDots[tab.id] ? 'On' : 'Off'}`}
                />
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'general' && (
        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">SLA Configuration</h2>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
              <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
                <div className="px-4 py-2.5">Priority</div>
                <div className="px-4 py-2.5">Response (hours)</div>
                <div className="px-4 py-2.5">Resolve (hours)</div>
                <div className="px-4 py-2.5" />
              </div>
              {slaConfigs.map((config) => (
                <SLARow key={config.priority} config={config} />
              ))}
            </div>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Analytics</h2>
            <ROISection />
          </section>
        </div>
      )}

      {activeTab === 'team' && (
        <section>
          <TeamSection />
        </section>
      )}

      {activeTab === 'discord' && (
        <section>
          <DiscordIntegrationCard />
        </section>
      )}

      {activeTab === 'slack' && (
        <section>
          <SlackIntegrationCard />
        </section>
      )}

      {activeTab === 'google-chat' && (
        <section>
          <GoogleChatIntegrationCard />
        </section>
      )}

      {activeTab === 'telegram' && (
        <section>
          <TelegramIntegrationCard />
        </section>
      )}

      {activeTab === 'discourse' && (
        <section>
          <DiscourseIntegrationCard />
        </section>
      )}

      {activeTab === 'circle' && (
        <section>
          <CircleIntegrationCard />
        </section>
      )}

      {activeTab === 'email' && (
        <section>
          <EmailIntegrationCard />
        </section>
      )}

      {activeTab === 'github' && (
        <section>
          <GitHubIntegrationCard />
        </section>
      )}

      {activeTab === 'notion' && (
        <section>
          <NotionIntegrationCard />
        </section>
      )}

      {activeTab === 'ai' && (
        <section>
          <AIModelSection />
        </section>
      )}

      {activeTab === 'widget' && (
        <section>
          <WidgetSection />
        </section>
      )}

      {activeTab === 'api-keys' && (
        <section>
          <ApiKeysSection />
        </section>
      )}

      {activeTab === 'danger' && (
        <section>
          <DangerZoneSection />
        </section>
      )}
    </div>
  )
}

function ROISection() {
  const [state, formAction, pending] = useActionState(saveROIConfigAction, null)
  const [editing, setEditing] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-medium text-gray-900">ROI Assumptions</p>
          <p className="text-xs text-gray-500 mt-0.5">Used to calculate time and money saved on the Analytics page.</p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Minutes per ticket
              </label>
              <input
                name="minutesPerTicket"
                type="number"
                min={1}
                max={480}
                defaultValue={10}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">Average staff time to answer one question manually.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Staff hourly rate ($)
              </label>
              <input
                name="staffHourlyRate"
                type="number"
                min={1}
                max={10000}
                defaultValue={50}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">Fully-loaded cost per hour for your support staff.</p>
            </div>
          </div>

          {state && 'error' in state && (
            <p className="text-xs text-red-600">{state.error}</p>
          )}
          {state && 'success' in state && (
            <p className="text-xs text-green-600">Saved.</p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-gray-500">
          Using defaults (10 min/ticket · $50/hr) unless you set custom values above.
        </p>
      )}
    </div>
  )
}
