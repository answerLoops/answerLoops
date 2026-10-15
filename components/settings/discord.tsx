'use client'

import { useActionState, useCallback, useEffect, useState, useTransition } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  saveDiscordIntegrationAction,
  deleteDiscordIntegrationAction,
  getCurrentDeploymentMode,
  saveDiscordGuildChannelsAction,
  removeDiscordGuildAction,
  updateDiscordAutoDeflectAction,
} from '@/lib/actions/integrations'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'

interface DiscordIntegration {
  id: number
  platform: string
  channel_ids: string[]
  connected_guild_id: string | null
  escalation_role_id: string | null
  confidence_threshold: number | null
  auto_deflect_enabled: number
  enabled: number
  bot_token_last4: string | null
  has_bot_token: boolean
}

interface DiscordGuild {
  id: number
  guild_id: string
  guild_name: string | null
  channel_ids: string[]
  escalation_role_id: string | null
  enabled: number
}

// The callback reports why a connect attempt failed as a short code in the
// redirect URL. Turn each into something the person can act on.
export function discordConnectErrorMessage(code: string): string {
  switch (code) {
    case 'guild_already_connected':
      return 'That Discord server is already connected to another answerLoops account.'
    case 'plan_required':
      return 'Discord needs the Standard plan or above. Upgrade your plan, then connect again.'
    case 'forbidden':
      return 'Only workspace owners and admins can connect Discord.'
    case 'not_guild_admin':
      return 'To connect a server you need to own it or have the Manage Server permission there.'
    case 'bot_not_in_guild':
      return 'answerLoops was not added to that server. Please try again and keep the bot selected.'
    case 'guild_not_authorized':
      return 'Discord did not tell us which server you picked. Please try again and choose a server.'
    case 'invalid_state':
      return 'That connection attempt expired or was started in a different window. Please try again.'
    case 'token_exchange_failed':
      return 'Discord did not accept the authorization. Please try again.'
    case 'server_misconfigured':
      return 'Discord is not fully set up on this deployment. Ask whoever runs answerLoops to check the Discord settings.'
    case 'access_denied':
    case 'cancelled':
      return 'The Discord connection was cancelled. Nothing was changed.'
    case 'server_error':
      return 'Something went wrong on our side while connecting that server. Please try again.'
    default:
      return 'The Discord connection did not complete. Please try again.'
  }
}

export function DiscordIntegrationCard() {
  // Legacy manual bot-token connection (self-hosters) — separate from and
  // independent of the OAuth-connected guilds list below.
  const [integration, setIntegration] = useState<DiscordIntegration | null | undefined>(undefined)
  const [legacyEditing, setLegacyEditing] = useState(false)
  // OAuth-connected servers — an org can have any number of these.
  const [guilds, setGuilds] = useState<DiscordGuild[] | undefined>(undefined)
  const [inviting, setInviting] = useState(false)
  const [justConnectedGuildId, setJustConnectedGuildId] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  // Unknown until the server answers; the stale-manual-setup notice only makes
  // sense on the hosted product, so it waits for a definite "cloud".
  const [selfHosted, setSelfHosted] = useState<boolean | undefined>(undefined)
  const { toastMessage, toastKind, showToast } = useToast()
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
    getCurrentDeploymentMode().then((mode) => setSelfHosted(mode === 'self-hosted'), () => setSelfHosted(undefined))
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
      // Kept on screen until dismissed: the reason is the only way to know why
      // a connect attempt came back with nothing connected.
      setConnectError(discordConnectErrorMessage(error))
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
        setConnectError(data.error ?? 'Could not start the Discord connection. Please try again.')
        setInviting(false)
      }
    } catch {
      setConnectError('Could not start the Discord connection. Please try again.')
      setInviting(false)
    }
  }

  if (integration === undefined || guilds === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  // A one-click connect also leaves an org-level row behind (it carries the
  // shared secret) with no bot token on it. Only a row that actually holds a
  // token is a manual setup.
  const legacyConnected = integration !== null && integration.enabled === 1 && integration.has_bot_token
  // On the hosted product the platform connects to Discord with its own bot,
  // and only forwards messages for servers connected with the button. A token
  // saved on a workspace is never used to log in, so a manual setup with no
  // connected server receives nothing, however active it looks.
  const manualSetupInactive = legacyConnected && selfHosted === false && guilds.length === 0
  const serversNeedingChannels = guilds.filter((g) => g.channel_ids.length === 0)
  const needsChannels = serversNeedingChannels.length > 0

  const statusText = guilds.length > 0
    ? `${guilds.length} server${guilds.length === 1 ? '' : 's'} connected${
        needsChannels
          ? ` · ${serversNeedingChannels.length} ${serversNeedingChannels.length === 1 ? 'needs' : 'need'} channels`
          : ''
      }`
    : manualSetupInactive
    ? 'Old manual setup · not receiving messages'
    : legacyConnected
    ? `Connected · ${integration!.channel_ids.length} channel(s)`
    : 'Not connected'

  const statusBadge = needsChannels
    ? { label: 'Needs channels', className: 'bg-amber-100 text-amber-800' }
    : manualSetupInactive
    ? { label: 'Not receiving', className: 'bg-amber-100 text-amber-800' }
    : guilds.length > 0 || legacyConnected
    ? { label: 'Active', className: 'bg-green-100 text-green-700' }
    : { label: 'Inactive', className: 'bg-gray-100 text-gray-500' }

  const connectBox = (
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
  )

  const guildCards = guilds.map((guild) => (
    <DiscordGuildCard
      key={guild.id}
      guild={guild}
      onChanged={reloadGuilds}
      showToast={showToast}
      autoEdit={guild.guild_id === justConnectedGuildId}
      onAutoEditConsumed={() => setJustConnectedGuildId(null)}
    />
  ))

  return (
    <>
      {toastMessage && <Toast message={toastMessage} kind={toastKind} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        {connectError && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <span className="min-w-0 break-words">{connectError}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setConnectError(null)}
              className="shrink-0 text-red-600 hover:text-red-800"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-8 h-8 shrink-0 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-sm font-bold">D</div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Discord</p>
              <p className="text-xs text-gray-500">{statusText}</p>
            </div>
          </div>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        </div>

        {manualSetupInactive && (
          <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-1">
            <p className="font-medium">answerLoops is not reading any messages from Discord yet.</p>
            <p className="text-xs">
              This workspace has an older manual setup with a saved bot token. That setup no longer connects to Discord,
              so nothing is being received even though the details below are saved. Add answerLoops to your server with
              the button, pick your channels, then remove the old setup. You will need to choose your channels again.
            </p>
          </div>
        )}

        {/* Servers that still need channels come first: choosing them is the step
            that makes the connection do anything, so it should not sit below
            the connect button and the other settings. */}
        {needsChannels ? (
          <>
            {guildCards}
            {connectBox}
          </>
        ) : (
          <>
            {/* One-click connect — always available, even with servers already connected */}
            {connectBox}
            {guildCards}
          </>
        )}

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

        {/* Legacy manual setup — only a row that really holds a bot token */}
        {legacyConnected && !legacyEditing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            {(manualSetupInactive || (selfHosted === false && guilds.length > 0)) && (
              <p className="py-1 text-xs font-medium text-amber-800">
                Old manual setup — not in use. Connected servers above are what answerLoops reads.
              </p>
            )}
            <ReadOnlyRow
              label="Bot Token"
              value={integration!.bot_token_last4 ? `••••${integration!.bot_token_last4} (connected)` : '••••••••• (saved)'}
            />
            <ReadOnlyRow label="Channel IDs" value={integration!.channel_ids.join(', ') || '—'} />
            {integration!.escalation_role_id && (
              <ReadOnlyRow label="Escalation Role ID" value={integration!.escalation_role_id} />
            )}
            <ReadOnlyRow label="Confidence threshold" value={String(integration!.confidence_threshold ?? 0.8)} />
            <div className="flex flex-col items-start gap-1 py-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-gray-500 shrink-0">Automatic Deflections</span>
              <DeflectionStatusBadge enabled={integration!.auto_deflect_enabled === 1} />
            </div>
            <div className="pt-2 flex flex-wrap gap-2">
              {!manualSetupInactive && (
                <Button size="sm" variant="secondary" onClick={() => setLegacyEditing(true)}>
                  Edit channels &amp; deflections
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={deletePending}
                onClick={() => startDeleteTransition(() => { deleteAction(new FormData()) })}
              >
                {deletePending
                  ? 'Removing…'
                  : manualSetupInactive || (selfHosted === false && guilds.length > 0)
                  ? 'Remove old setup'
                  : 'Disconnect'}
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
            <div className="flex flex-wrap gap-2">
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
  // A server with no channels saved reads nothing, so it opens straight into
  // the picker rather than waiting for an "Edit channels" click.
  const hasNoChannels = guild.channel_ids.length === 0
  const [editingChannels, setEditingChannels] = useState(autoEdit || hasNoChannels)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [channelsLoad, setChannelsLoad] = useState<'loading' | 'loaded' | 'failed'>('loading')
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
      // Saving nothing would leave the server looking connected while reading
      // no messages — the exact state this step exists to avoid.
      const picked = fd.getAll('channelIds').flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean)
      if (picked.length === 0) {
        return { error: 'Choose at least one channel so answerLoops knows where to listen.' }
      }
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
    let cancelled = false
    setChannelsLoad('loading')
    fetch(`/api/discord/guilds?guild_id=${guild.guild_id}`)
      .then(async (r) => {
        const data = (await r.json()) as { channels?: { id: string; name: string }[] }
        if (cancelled) return
        if (!r.ok) { setChannelsLoad('failed'); return }
        setChannels(data.channels ?? [])
        setChannelsLoad('loaded')
      })
      .catch(() => { if (!cancelled) setChannelsLoad('failed') })
    return () => { cancelled = true }
  }, [editingChannels, channels.length, guild.guild_id])

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-gray-900">{guild.guild_name ?? `Server ${guild.guild_id}`}</p>
        {!editingChannels && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant={hasNoChannels ? 'primary' : 'secondary'} onClick={() => setEditingChannels(true)}>
              {hasNoChannels ? 'Connect channels' : 'Edit channels'}
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

      {hasNoChannels && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">This server does not have any channels connected</p>
          <p className="text-xs mt-0.5">answerLoops only reads the channels you connect. Pick the channels to monitor, then save.</p>
        </div>
      )}

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
              {channels.length === 0 && channelsLoad === 'loading' && <span className="text-gray-400 font-normal ml-1">(loading…)</span>}
            </label>
            {channels.length > 0 ? (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 max-h-48 overflow-y-auto rounded border border-gray-200 p-2 bg-white">
                {channels.map((ch) => (
                  <label key={ch.id} className="flex min-w-0 items-center gap-2 break-all text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
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
              <>
                {channelsLoad === 'failed' && (
                  <p role="alert" className="mb-2 text-xs text-amber-800">
                    Could not load this server&apos;s channels. Check that answerLoops can view them in Discord, then try
                    again, or paste the channel IDs below.
                  </p>
                )}
                <input
                  name="channelIds"
                  type="text"
                  defaultValue={guild.channel_ids.join(', ')}
                  placeholder="123456789, 987654321"
                  className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                />
              </>
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
          <div className="flex flex-wrap gap-2">
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

