'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { updateWorkspaceNameAction, completeOnboardingAction } from '@/app/actions/onboarding'
import { saveDiscordIntegrationAction, saveDiscordGuildChannelsAction, saveTelegramIntegrationAction, saveSlackChannelsAction } from '@/app/actions/integrations'
import { ingestUrlAction } from '@/app/actions/ingest-url'
import type { IngestUrlResult } from '@/app/actions/ingest-url'

// ── Icons ─────────────────────────────────────────────────────────────────────

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  )
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )
}

// ── Shared UI ──────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors'

function PrimaryButton({ pending, label, pendingLabel, color, type = 'submit', onClick }: {
  pending?: boolean; label: string; pendingLabel?: string
  color?: 'discord' | 'slack' | 'telegram' | 'default'
  type?: 'submit' | 'button'
  onClick?: () => void
}) {
  const colors =
    color === 'discord'  ? 'bg-[#5865F2] hover:bg-[#4752c4] text-white shadow-[#5865F2]/25' :
    color === 'slack'    ? 'bg-[#4A154B] hover:bg-[#3d1040] text-white shadow-[#4A154B]/25' :
    color === 'telegram' ? 'bg-[#229ED9] hover:bg-[#1a8ec5] text-white shadow-[#229ED9]/25' :
                           'bg-brand-600 hover:bg-brand-700 text-white shadow-brand-600/25'
  return (
    <button
      type={type}
      disabled={pending}
      onClick={onClick}
      className={`w-full rounded-xl px-4 py-3 text-sm font-semibold shadow-md transition-all disabled:opacity-50 disabled:shadow-none ${colors}`}
    >
      {pending ? (pendingLabel ?? label) : label}
    </button>
  )
}

function PlatformCard({ icon, label, badge, bg, borderColor, onClick }: {
  icon: React.ReactNode; label: string; badge?: string; bg: string; borderColor: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center gap-3 rounded-2xl border-2 p-5 text-sm font-semibold text-gray-700 transition-all hover:shadow-md active:scale-[0.98] ${bg} ${borderColor}`}
    >
      {badge && (
        <span className="absolute top-2 right-2 text-[0.5625rem] font-bold uppercase tracking-wider text-white bg-brand-500 rounded-full px-1.5 py-0.5 leading-tight">
          {badge}
        </span>
      )}
      {icon}
      {label}
    </button>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Back
    </button>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

// ── Step 1: Name ───────────────────────────────────────────────────────────────

function NameStep({ onDone, initialName }: { onDone: () => void; initialName: string }) {
  const [state, formAction, pending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await updateWorkspaceNameAction(prev, fd)
      if (!result?.error) onDone()
      return result
    },
    null
  )

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-gray-900">Name your workspace</h2>
        <p className="text-sm text-gray-500">This is how your team will identify this workspace.</p>
      </div>
      <form action={formAction} className="space-y-6">
        <Field label="Workspace name">
          <input
            name="name"
            type="text"
            defaultValue={initialName}
            placeholder="Acme Community"
            className={inputCls}
            required
            autoFocus
          />
        </Field>
        {(state as { error?: string } | null)?.error && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{(state as { error?: string }).error}</p>
        )}
        <PrimaryButton pending={pending} label="Continue →" pendingLabel="Saving…" />
      </form>
    </div>
  )
}

// ── Step 2: Connect ────────────────────────────────────────────────────────────

type Platform = 'discord' | 'slack' | 'telegram' | null
type DiscordSubStep = 'choose' | 'invite' | 'channels' | 'manual'

interface GuildChannel { id: string; name: string }
interface Guild { id: string; name: string; channels: GuildChannel[] }

const BOT_PERMISSIONS = '85056'

function DiscordFlow({ onDone, onBack, oauthGuildId }: { onDone: () => void; onBack: () => void; oauthGuildId?: string }) {
  const [subStep, setSubStep] = useState<DiscordSubStep>(oauthGuildId ? 'channels' : 'choose')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState(false)
  // manual flow state
  const [clientId, setClientId] = useState('')
  const [botToken, setBotToken] = useState('')
  const [guilds, setGuilds] = useState<Guild[]>([])
  const [selectedGuild, setSelectedGuild] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set())
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Check if platform has DISCORD_CLIENT_ID configured (1-click mode)
  useEffect(() => {
    if (oauthGuildId) return
    setLoadingUrl(true)
    fetch('/api/discord/invite-url?from=onboarding')
      .then((r) => r.json())
      .then((data: { url?: string; error?: string }) => {
        if (data.url) setInviteUrl(data.url)
      })
      .catch(() => {})
      .finally(() => setLoadingUrl(false))
  }, [oauthGuildId])

  // Just returned from 1-click Discord OAuth — the bot already joined the
  // server, but no channels are monitored yet. Fetch this guild's channels
  // using the platform bot token (same endpoint Settings uses) and land
  // straight on the channel picker instead of silently completing with
  // zero channels monitored.
  useEffect(() => {
    if (!oauthGuildId) return
    setFetching(true)
    setFetchError('')
    fetch(`/api/discord/guilds?guild_id=${oauthGuildId}`)
      .then((r) => r.json())
      .then((data: { guildId?: string; channels?: GuildChannel[]; error?: string }) => {
        if (data.error || !data.channels) {
          setFetchError(data.error ?? 'Could not load channels for this server.')
          return
        }
        setGuilds([{ id: oauthGuildId, name: 'Your server', channels: data.channels }])
        setSelectedGuild(oauthGuildId)
      })
      .catch(() => setFetchError('Failed to reach Discord — check your internet connection.'))
      .finally(() => setFetching(false))
  }, [oauthGuildId])

  const manualInviteUrl = clientId.trim()
    ? `https://discord.com/oauth2/authorize?client_id=${clientId.trim()}&scope=bot&permissions=${BOT_PERMISSIONS}`
    : ''

  async function fetchGuilds(token: string) {
    setFetching(true)
    setFetchError('')
    try {
      const res = await fetch('/api/discord/guilds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json() as Guild[] | { error: string }
      if ('error' in data) { setFetchError(data.error); return }
      setGuilds(data)
      if (data.length === 1) setSelectedGuild(data[0].id)
      setSubStep('channels')
    } catch {
      setFetchError('Failed to reach Discord — check your internet connection.')
    } finally {
      setFetching(false)
    }
  }

  async function save() {
    if (!selectedGuild || selectedChannels.size === 0) return
    setSaving(true); setSaveError('')
    const fd = new FormData()
    fd.set('channelIds', [...selectedChannels].join(','))
    let result: { error?: string } | null
    if (oauthGuildId) {
      fd.set('guildId', oauthGuildId)
      result = await saveDiscordGuildChannelsAction(null, fd) as { error?: string } | null
    } else {
      fd.set('botToken', botToken)
      result = await saveDiscordIntegrationAction(null, fd) as { error?: string } | null
    }
    if (result?.error) { setSaveError(result.error); setSaving(false); return }
    onDone()
  }

  function toggleChannel(id: string) {
    setSelectedChannels((prev) => {
      const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
    })
  }

  const activeGuild = guilds.find((g) => g.id === selectedGuild)

  // 1-click: navigate current tab to Discord OAuth, callback returns to /onboarding?discord_connected=1
  if (subStep === 'choose' && !loadingUrl) {
    return (
      <div className="space-y-5">
        <BackButton onClick={onBack} />
        {inviteUrl ? (
          <>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-gray-800">Add answerLoops to your Discord server</p>
              <p className="text-xs text-gray-500">Click below, pick your server, click Authorize — you'll be brought right back.</p>
            </div>
            <a
              href={inviteUrl}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#5865F2] hover:bg-[#4752c4] px-4 py-3 text-sm font-semibold text-white transition-all shadow-md shadow-[#5865F2]/25"
            >
              <DiscordIcon className="h-4 w-4" />
              Add to Discord — 1 click →
            </a>
            <button type="button" onClick={() => setSubStep('manual')} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Already have a bot? Use manual setup instead
            </button>
          </>
        ) : (
          // Platform has no DISCORD_CLIENT_ID — manual flow
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 space-y-1.5">
              <p className="font-semibold">2 things needed from Discord Developer Portal</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-600">
                <li>Go to <span className="font-mono">discord.com/developers</span> → New Application</li>
                <li>Bot tab → Reset Token → copy it below</li>
                <li>Enable <strong>Message Content Intent</strong> under Privileged Gateway Intents → Save</li>
                <li>Copy <strong>Application ID</strong> from General Information → paste below</li>
              </ol>
            </div>
            <Field label="Application ID" hint="General Information tab — 'Application ID'">
              <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456789012345678" className={inputCls} />
            </Field>
            <Field label="Bot Token" hint="Bot tab → Reset Token">
              <input type="password" autoComplete="new-password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Paste your bot token" className={inputCls} />
            </Field>
            <button
              type="button"
              disabled={!clientId.trim() || !botToken.trim()}
              onClick={() => setSubStep('invite')}
              className="w-full rounded-xl bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-all"
            >
              Continue →
            </button>
          </div>
        )}
      </div>
    )
  }

  if (subStep === 'manual') {
    return (
      <div className="space-y-4">
        <BackButton onClick={() => setSubStep('choose')} />
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 space-y-1.5">
          <p className="font-semibold">Setup from Discord Developer Portal</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-600">
            <li>Go to <span className="font-mono">discord.com/developers</span> → New Application</li>
            <li>Bot tab → Reset Token → copy it below</li>
            <li>Enable <strong>Message Content Intent</strong> under Privileged Gateway Intents → Save</li>
            <li>Copy <strong>Application ID</strong> from General Information → paste below</li>
          </ol>
        </div>
        <Field label="Application ID" hint="General Information tab">
          <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456789012345678" className={inputCls} />
        </Field>
        <Field label="Bot Token" hint="Bot tab → Reset Token">
          <input type="password" autoComplete="new-password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Paste your bot token" className={inputCls} />
        </Field>
        <button
          type="button"
          disabled={!clientId.trim() || !botToken.trim()}
          onClick={() => setSubStep('invite')}
          className="w-full rounded-xl bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-all"
        >
          Continue →
        </button>
      </div>
    )
  }

  if (subStep === 'invite') {
    return (
      <div className="space-y-5">
        <BackButton onClick={() => setSubStep('choose')} />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-800">Add the bot to your Discord server</p>
          <p className="text-xs text-gray-500">Click below, pick your server, then come back here.</p>
        </div>
        <a href={manualInviteUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#5865F2] hover:bg-[#4752c4] px-4 py-3 text-sm font-semibold text-white transition-all">
          <DiscordIcon className="h-4 w-4" />
          Add to Discord →
        </a>
        <div className="relative flex items-center gap-3 py-0.5">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-[0.6875rem] text-gray-400 font-medium">once you've authorized</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>
        <button type="button" onClick={() => fetchGuilds(botToken)} disabled={fetching}
          className="w-full rounded-xl border-2 border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-all flex items-center justify-center gap-2">
          {fetching && <Spinner className="h-3.5 w-3.5 text-gray-400" />}
          {fetching ? 'Fetching your servers…' : "I've added the bot — fetch my channels"}
        </button>
        {fetchError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{fetchError}</p>}
      </div>
    )
  }

  // channels step
  return (
    <div className="space-y-5">
      <BackButton onClick={() => (oauthGuildId ? onBack() : setSubStep('invite'))} />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-800">
          {oauthGuildId ? 'Bot added — now pick channels to monitor' : 'Pick channels to monitor'}
        </p>
        <p className="text-xs text-gray-500">
          {oauthGuildId
            ? "Discord won't send any messages here until you select at least one channel."
            : 'Messages posted here become support tickets automatically.'}
        </p>
      </div>
      {fetching && guilds.length === 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
          <Spinner className="h-4 w-4 text-brand-500 shrink-0" />
          <p className="text-xs font-medium text-brand-700">Loading your server's channels…</p>
        </div>
      )}
      {fetchError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{fetchError}</p>}
      {guilds.length > 1 && (
        <Field label="Server">
          <select value={selectedGuild} onChange={(e) => { setSelectedGuild(e.target.value); setSelectedChannels(new Set()) }} className={inputCls}>
            <option value="">Select a server…</option>
            {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      )}
      {activeGuild && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 divide-y divide-gray-100 max-h-48 overflow-y-auto">
          {activeGuild.channels.length === 0
            ? <p className="px-4 py-3 text-xs text-gray-400">No text channels found in this server.</p>
            : activeGuild.channels.map((ch) => (
              <label key={ch.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white transition-colors">
                <input type="checkbox" checked={selectedChannels.has(ch.id)} onChange={() => toggleChannel(ch.id)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                <span className="text-sm text-gray-700"># {ch.name}</span>
              </label>
            ))
          }
        </div>
      )}
      {saveError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}
      <button type="button" onClick={save} disabled={saving || selectedChannels.size === 0 || !selectedGuild}
        className="w-full rounded-xl bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-all">
        {saving ? 'Connecting…' : `Connect ${selectedChannels.size > 0 ? `${selectedChannels.size} channel${selectedChannels.size > 1 ? 's' : ''}` : 'Discord'}`}
      </button>
    </div>
  )
}

function TelegramFlow({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveTelegramIntegrationAction(prev, fd)
      // A warning means the bot saved but webhook registration needs a retry
      // in Settings — still a completed step, so advance.
      if (!result?.error) onDone()
      return result
    },
    null
  )

  return (
    <div className="space-y-5">
      <BackButton onClick={onBack} />
      <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-700 space-y-1.5">
        <p className="font-semibold">Get your bot token from Telegram</p>
        <ol className="list-decimal list-inside space-y-1 text-sky-600">
          <li>Open Telegram → search <strong>@BotFather</strong></li>
          <li>Send <span className="font-mono">/newbot</span> and follow prompts</li>
          <li>Copy the token (format: <span className="font-mono">123456789:AAHdqTcv…</span>)</li>
        </ol>
      </div>
      <form action={formAction} className="space-y-4">
        <Field label="Bot Token">
          <input name="botToken" type="password" autoComplete="new-password"
            placeholder="123456789:AAHdqTcv…" className={inputCls} required />
        </Field>
        <p className="text-xs text-gray-400">After connecting, add your bot to your group so it can see messages. Its privacy mode must be off (BotFather → <span className="font-mono">/setprivacy</span> → Disable).</p>
        {(state as { error?: string } | null)?.error && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{(state as { error?: string }).error}</p>
        )}
        {(state as { warning?: string } | null)?.warning && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">{(state as { warning?: string }).warning}</p>
        )}
        <PrimaryButton pending={pending} label="Connect Telegram →" pendingLabel="Connecting…" color="telegram" />
      </form>
    </div>
  )
}

function ConnectStep({ onDone, oauthGuildId, slackConnected }: { onDone: () => void; oauthGuildId?: string; slackConnected?: boolean }) {
  const [platform, setPlatform] = useState<Platform>(oauthGuildId ? 'discord' : slackConnected ? 'slack' : null)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-gray-900">Connect your community</h2>
        <p className="text-sm text-gray-500">Choose where your community lives. You can change this later in Settings.</p>
      </div>

      {platform === null && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <PlatformCard
              icon={<DiscordIcon className="h-7 w-7 text-[#5865F2]" />}
              label="Discord"
              badge="1-click"
              bg="hover:bg-brand-50/60 bg-white"
              borderColor="border-gray-200 hover:border-[#5865F2]/50"
              onClick={() => setPlatform('discord')}
            />
            <PlatformCard
              icon={<SlackIcon className="h-7 w-7 text-[#4A154B]" />}
              label="Slack"
              badge="1-click"
              bg="hover:bg-purple-50/60 bg-white"
              borderColor="border-gray-200 hover:border-purple-400/50"
              onClick={() => setPlatform('slack')}
            />
            <PlatformCard
              icon={<TelegramIcon className="h-7 w-7 text-[#229ED9]" />}
              label="Telegram"
              bg="hover:bg-sky-50/60 bg-white"
              borderColor="border-gray-200 hover:border-sky-400/50"
              onClick={() => setPlatform('telegram')}
            />
          </div>
          <button type="button" onClick={onDone} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1">
            Skip for now — connect later in Settings
          </button>
        </>
      )}

      {platform === 'discord' && (
        <DiscordFlow onDone={onDone} onBack={() => setPlatform(null)} oauthGuildId={oauthGuildId} />
      )}

      {platform === 'telegram' && (
        <TelegramFlow onDone={onDone} onBack={() => setPlatform(null)} />
      )}

      {platform === 'slack' && (
        <SlackFlow onDone={onDone} onBack={() => setPlatform(null)} slackConnected={slackConnected} />
      )}
    </div>
  )
}

function SlackFlow({ onDone, onBack, slackConnected }: { onDone: () => void; onBack: () => void; slackConnected?: boolean }) {
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set())
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Just returned from 1-click Slack OAuth — workspace is authorized but no
  // channels are monitored yet. Land straight on the channel picker (same
  // endpoint Settings uses) instead of silently completing with zero
  // channels ingesting anything.
  useEffect(() => {
    if (!slackConnected) return
    setLoadingChannels(true)
    setFetchError('')
    fetch('/api/slack/channels')
      .then((r) => r.json())
      .then((data: { id: string; name: string }[] | { error: string }) => {
        if (Array.isArray(data)) setChannels(data)
        else setFetchError(data.error ?? 'Could not load channel list.')
      })
      .catch(() => setFetchError('Failed to reach Slack — check your internet connection.'))
      .finally(() => setLoadingChannels(false))
  }, [slackConnected])

  async function handleAddToSlack() {
    setConnecting(true)
    setConnectError(null)
    try {
      const res = await fetch('/api/slack/install?from=onboarding')
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      } else {
        setConnectError(data.error ?? 'Failed to get Slack install URL')
        setConnecting(false)
      }
    } catch {
      setConnectError('Failed to connect to Slack')
      setConnecting(false)
    }
  }

  function toggleChannel(id: string) {
    setSelectedChannels((prev) => {
      const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
    })
  }

  async function save() {
    if (selectedChannels.size === 0) return
    setSaving(true); setSaveError('')
    const fd = new FormData()
    fd.set('channelIds', [...selectedChannels].join(','))
    const result = await saveSlackChannelsAction(null, fd) as { error?: string } | null
    if (result?.error) { setSaveError(result.error); setSaving(false); return }
    onDone()
  }

  if (!slackConnected) {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} />
        <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <SlackIcon className="h-4 w-4 text-[#4A154B]" />
            <p className="text-sm font-semibold text-purple-900">Connect Slack in one click</p>
          </div>
          <p className="text-xs text-purple-700">
            Click below to authorize answerLoops in your Slack workspace. You&apos;ll pick which channels to monitor after connecting.
          </p>
        </div>
        {connectError && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{connectError}</p>
        )}
        <PrimaryButton
          type="button"
          pending={connecting}
          label="Add to Slack"
          pendingLabel="Redirecting to Slack…"
          color="slack"
          onClick={handleAddToSlack}
        />
        <button type="button" onClick={onDone} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1">
          Skip — I&apos;ll connect Slack in Settings
        </button>
      </div>
    )
  }

  // Channel picker — workspace authorized, nothing monitored yet. No "back"
  // affordance here: the workspace is already connected server-side, so
  // there's nothing to undo by going back to the platform picker.
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-800">Workspace connected — now pick channels to monitor</p>
        <p className="text-xs text-gray-500">Slack won&apos;t send any messages here until you select at least one channel.</p>
      </div>
      {loadingChannels && (
        <div className="flex items-center gap-2.5 rounded-xl border border-purple-100 bg-purple-50 px-4 py-3">
          <Spinner className="h-4 w-4 text-purple-500 shrink-0" />
          <p className="text-xs font-medium text-purple-700">Loading your workspace&apos;s channels…</p>
        </div>
      )}
      {fetchError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{fetchError}</p>}
      {channels.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 divide-y divide-gray-100 max-h-48 overflow-y-auto">
          {channels.map((ch) => (
            <label key={ch.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white transition-colors">
              <input type="checkbox" checked={selectedChannels.has(ch.id)} onChange={() => toggleChannel(ch.id)}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-gray-700"># {ch.name}</span>
            </label>
          ))}
        </div>
      )}
      {saveError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}
      <button type="button" onClick={save} disabled={saving || selectedChannels.size === 0}
        className="w-full rounded-xl bg-[#4A154B] hover:bg-[#3d1040] disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-all">
        {saving ? 'Connecting…' : `Connect ${selectedChannels.size > 0 ? `${selectedChannels.size} channel${selectedChannels.size > 1 ? 's' : ''}` : 'channels'}`}
      </button>
      <button type="button" onClick={onDone} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors">
        Skip — I&apos;ll pick channels later in Settings
      </button>
    </div>
  )
}


// ── Step 3: Seed KB ────────────────────────────────────────────────────────────

type SeedMode = 'choose' | 'file' | 'url'

function SeedStep({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<SeedMode>('choose')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ error?: string; created?: number; filename?: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [urlResult, urlAction, urlPending] = useActionState<IngestUrlResult, FormData>(
    async (prev, fd) => {
      const r = await ingestUrlAction(prev, fd)
      if (!r.error) onDone()
      return r
    },
    {}
  )

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true); setUploadResult(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      const res = await fetch('/api/kb/upload', { method: 'POST', body: fd })
      const data = await res.json() as { error?: string; created?: number; filename?: string }
      setUploadResult(data)
      if (!data.error) setTimeout(onDone, 1200)
    } catch {
      setUploadResult({ error: 'Upload failed. Try again.' })
    } finally {
      setUploading(false)
    }
  }, [onDone])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-gray-900">Seed your knowledge base</h2>
        <p className="text-sm text-gray-500">Give the AI something to work from before any tickets arrive.</p>
      </div>

      {mode === 'choose' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setMode('file')}
              className="flex flex-col items-center gap-2.5 rounded-2xl border-2 border-gray-200 bg-white p-5 text-sm font-semibold text-gray-700 transition-all hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-md">
              <svg className="h-7 w-7 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 16V8m0 0l-3 3m3-3l3 3M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Upload file
              <span className="text-[0.625rem] font-normal text-gray-400">PDF · DOCX · MD · TXT · CSV</span>
            </button>
            <button onClick={() => setMode('url')}
              className="flex flex-col items-center gap-2.5 rounded-2xl border-2 border-gray-200 bg-white p-5 text-sm font-semibold text-gray-700 transition-all hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-md">
              <svg className="h-7 w-7 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Crawl a URL
              <span className="text-[0.625rem] font-normal text-gray-400">Docs site · Wiki · Blog</span>
            </button>
          </div>
          <button type="button" onClick={onDone}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1">
            Skip for now — add content later in the KB page
          </button>
        </div>
      )}

      {mode === 'file' && (
        <div className="space-y-4">
          <BackButton onClick={() => setMode('choose')} />
          <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors ${
              uploading ? 'pointer-events-none opacity-60 border-gray-200' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'
            }`}>
            <input ref={inputRef} type="file" accept=".pdf,.docx,.md,.txt,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
            {uploading ? (
              <><Spinner className="h-6 w-6 text-brand-500" />
              <p className="text-sm font-medium text-brand-700">Parsing and embedding…</p>
              <p className="text-xs text-brand-500">May take 15–60 s for large files.</p></>
            ) : uploadResult?.created != null ? (
              <><div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                <CheckIcon className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-sm font-medium text-green-700">{uploadResult.created} chunks added from {uploadResult.filename}</p>
              <p className="text-xs text-green-500">Continuing…</p></>
            ) : (
              <><svg className="h-6 w-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 16V8m0 0l-3 3m3-3l3 3M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-sm text-gray-600"><span className="font-semibold text-brand-600">Click to upload</span> or drag and drop</p>
              <p className="text-xs text-gray-400">PDF · DOCX · MD · TXT · CSV up to 50 MB</p></>
            )}
          </div>
          {uploadResult?.error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{uploadResult.error}</p>}
        </div>
      )}

      {mode === 'url' && (
        <div className="space-y-4">
          <BackButton onClick={() => setMode('choose')} />
          <form action={urlAction} className="space-y-4">
            <input type="hidden" name="mode" value="page" />
            <Field label="Docs URL" hint="Paste a public docs page or site root. We'll crawl and embed the content.">
              <input name="url" type="url" required disabled={urlPending}
                placeholder="https://docs.yourproduct.com" className={inputCls} />
            </Field>
            {urlPending && (
              <div className="flex items-center gap-2.5 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
                <Spinner className="h-4 w-4 text-brand-500 shrink-0" />
                <p className="text-xs font-medium text-brand-700">Crawling and embedding — this can take up to 60 s…</p>
              </div>
            )}
            {urlResult.error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{urlResult.error}</p>}
            {urlResult.created != null && !urlResult.error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-green-100 bg-green-50 px-4 py-3">
                <CheckIcon className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-xs font-medium text-green-700">
                  {urlResult.pages != null
                    ? `${urlResult.created} articles from ${urlResult.pages} pages added.`
                    : `${urlResult.created} articles added.`}
                </p>
              </div>
            )}
            <PrimaryButton pending={urlPending} label="Import URL" pendingLabel="Importing…" />
          </form>
        </div>
      )}
    </div>
  )
}

// ── Step 4: Done ───────────────────────────────────────────────────────────────

function DoneStep({ completedSteps }: { completedSteps: Set<string> }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFinish() {
    setLoading(true)
    setError(null)
    const result = await completeOnboardingAction()
    if (result?.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    router.push('/dashboard')
  }

  const items = [
    { key: 'name',    label: 'Workspace named' },
    { key: 'connect', label: 'Community connected' },
    { key: 'seed',    label: 'Knowledge base seeded' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="flex justify-center mb-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-emerald-500 shadow-lg shadow-green-500/25">
            <CheckIcon className="h-8 w-8 text-white" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900">You're all set!</h2>
        <p className="text-sm text-gray-500">Your workspace is ready. Here's what was completed:</p>
      </div>

      <ul className="space-y-2.5">
        {items.map(({ key, label }) => (
          <li key={key} className="flex items-center gap-3">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${completedSteps.has(key) ? 'bg-green-100' : 'bg-gray-100'}`}>
              {completedSteps.has(key)
                ? <CheckIcon className="h-3.5 w-3.5 text-green-600" />
                : <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
              }
            </div>
            <span className={`text-sm font-medium ${completedSteps.has(key) ? 'text-gray-800' : 'text-gray-400'}`}>{label}</span>
            {!completedSteps.has(key) && <span className="text-xs text-gray-300">— skipped</span>}
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
        <p className="font-semibold text-gray-800 text-sm">What's next</p>
        <ul className="space-y-1.5 text-xs text-gray-500">
          <li>• Post a message in your connected channel → it appears as a ticket at <strong>/tickets</strong></li>
          <li>• The AI drafts an answer automatically and routes low-confidence ones to you</li>
          <li>• Add more content to the KB at <strong>/kb</strong> any time</li>
          <li>• Fine-tune AI model, SLA, and channels in <strong>Settings</strong></li>
        </ul>
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <button onClick={handleFinish} disabled={loading}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition-all disabled:opacity-60 shadow-md shadow-brand-600/25">
        {loading ? 'Loading dashboard…' : 'Go to dashboard →'}
      </button>
    </div>
  )
}

// ── Shell ──────────────────────────────────────────────────────────────────────

type Step = 'name' | 'connect' | 'seed' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'name',    label: 'Workspace' },
  { key: 'connect', label: 'Connect' },
  { key: 'seed',    label: 'Seed KB' },
  { key: 'done',    label: 'Go live' },
]

export default function OnboardingWizard({ initialName }: { initialName: string }) {
  const searchParams = useSearchParams()
  const [step, setStep] = useState<Step>('name')
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [discordOAuthGuildId, setDiscordOAuthGuildId] = useState<string | undefined>()
  const [slackConnected, setSlackConnected] = useState(false)

  // After Discord OAuth callback the bot has joined the server, but no
  // channels are monitored yet — land on the channel picker (Connect step)
  // instead of skipping straight to Seed KB, or messages posted before the
  // user finds Settings → Integrations would silently never become tickets.
  useEffect(() => {
    if (searchParams.get('discord_connected') === '1') {
      const guildId = searchParams.get('guild_id') ?? undefined
      setCompleted((prev) => new Set([...prev, 'name']))
      setStep('connect')
      setDiscordOAuthGuildId(guildId)
      // Clean the query params without a full reload
      const url = new URL(window.location.href)
      url.searchParams.delete('discord_connected')
      url.searchParams.delete('guild_id')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])

  // Same reasoning as Discord above: the workspace is authorized but no
  // channels are monitored yet — land on the channel picker (Connect step)
  // instead of silently completing with zero channels ingesting anything.
  useEffect(() => {
    if (searchParams.get('slack_connected') === '1') {
      setCompleted((prev) => new Set([...prev, 'name']))
      setStep('connect')
      setSlackConnected(true)
      const url = new URL(window.location.href)
      url.searchParams.delete('slack_connected')
      url.searchParams.delete('slack_team')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  function advance(from: Step) {
    setCompleted((prev) => new Set([...prev, from]))
    const next = STEPS[STEPS.findIndex((s) => s.key === from) + 1]
    if (next) setStep(next.key)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-brand-50/30 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-gray-200/80 bg-white px-8 py-10 shadow-xl shadow-gray-900/5">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2.5 mb-7">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 shadow-md shadow-brand-600/30">
                <svg className="h-4.5 w-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z"/>
                </svg>
              </div>
              <span className="text-sm font-bold text-gray-900 tracking-tight">answerLoops</span>
            </div>

            {/* Progress stepper */}
            <div className="flex items-center">
              {STEPS.map(({ key, label }, i) => (
                <div key={key} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                      i < stepIndex
                        ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                        : i === stepIndex
                        ? 'border-2 border-brand-600 text-brand-600 bg-white'
                        : 'border-2 border-gray-200 text-gray-300 bg-white'
                    }`}>
                      {i < stepIndex ? <CheckIcon className="h-4 w-4" /> : i + 1}
                    </div>
                    <span className={`text-[0.625rem] font-semibold whitespace-nowrap tracking-wide ${i === stepIndex ? 'text-brand-600' : 'text-gray-400'}`}>{label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1.5 mb-5 rounded-full transition-colors ${i < stepIndex ? 'bg-brand-600' : 'bg-gray-200'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step content */}
          {step === 'name'    && <NameStep    initialName={initialName} onDone={() => advance('name')} />}
          {step === 'connect' && <ConnectStep onDone={() => advance('connect')} oauthGuildId={discordOAuthGuildId} slackConnected={slackConnected} />}
          {step === 'seed'    && <SeedStep    onDone={() => advance('seed')} />}
          {step === 'done'    && <DoneStep    completedSteps={completed} />}
        </div>
      </div>
    </div>
  )
}
