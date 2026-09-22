'use client'

import { useActionState, useRef, useTransition } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { updateSLAAction } from '@/lib/actions/sla'
import { sendInviteAction, revokeInviteAction, removeMemberAction, transferOwnershipAction } from '@/lib/actions/invitations'
import { getWidgetTokenAction, regenerateWidgetTokenAction, saveWidgetOriginsAction } from '@/lib/actions/widget'
import { saveAIConfigAction, clearAIConfigAction, testAIConfigAction, listModelsAction } from '@/lib/actions/ai-config'
import type { AIConnectionResult } from '@/lib/ai/test-connection'
import { saveROIConfigAction } from '@/lib/actions/roi'
import { createApiKeyAction, revokeApiKeyAction } from '@/lib/actions/api-keys'
import { API_SCOPES, ALL_SCOPES } from '@/lib/agent/scopes'
import { deleteAccountAction, getCurrentOrgName } from '@/lib/actions/account'
import { Button } from '@/components/ui/button'
import type { SLAConfig } from '@/types'
import { subscribeLiveEvents } from '@/lib/live-events'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'

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

// Fallback lists only — shown before "Refresh models" has fetched a live
// list (or if that fetch fails), so they're allowed to go stale between
// releases without breaking anything. See lib/ai/list-models.ts for the
// live source of truth.
const CHAT_PROVIDERS = [
  {
    value: 'openai',
    label: 'OpenAI',
    placeholder: 'gpt-6-astra',
    models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
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
    value: 'xai',
    label: 'xAI (Grok)',
    placeholder: 'grok-4',
    // No hand-curated fallback — Grok models are named/versioned unlike
    // anything above, and guessing an ID here risks shipping one that never
    // existed. "Refresh models" (live from xAI's own /v1/models) is the only
    // source for this provider; until that's run, Model ID is free text.
    models: [] as string[],
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio, vLLM…)',
    placeholder: 'llama3.2',
    models: [] as string[],
  },
]

/**
 * Resolve which model to show and whether that provider's field should be a
 * dropdown or free text, given a preferred model (usually a saved config's
 * chat_model). A provider with no curated list is always free text. A
 * preferred model outside the curated list is kept and shown as free text
 * too, rather than silently swapped for the list's first entry.
 */
function resolveChatModel(providerValue: string, preferredModel?: string | null): { model: string; custom: boolean } {
  const meta = CHAT_PROVIDERS.find((p) => p.value === providerValue) ?? CHAT_PROVIDERS[0]
  if (meta.models.length === 0) return { model: preferredModel ?? '', custom: true }
  if (preferredModel && meta.models.includes(preferredModel)) return { model: preferredModel, custom: false }
  if (preferredModel) return { model: preferredModel, custom: true }
  return { model: meta.models[0], custom: false }
}

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
  // The Model ID field is a real <select> of curated models per provider, not
  // a free-text input — but a provider can have a model the curated list
  // doesn't know about yet (a brand-new release, or one only the org's own
  // account has access to), and openai-compatible providers (Ollama, LM
  // Studio, vLLM) have no fixed list at all. customModel switches to a plain
  // text input for those cases instead of silently overwriting the saved value.
  const [chatModel, setChatModel] = useState(CHAT_PROVIDERS[0].models[0])
  const [customModel, setCustomModel] = useState(false)
  const [editing, setEditing] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startClearTransition] = useTransition()
  const [trialStatus, setTrialStatus] = useState<{ used: number; limit: number; remaining: number; exhausted: boolean } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [testing, startTest] = useTransition()
  const [testResult, setTestResult] = useState<AIConnectionResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Live model list, fetched on demand rather than relying on the hardcoded
  // CHAT_PROVIDERS fallback going stale between releases. Cleared whenever
  // the provider changes, since a previous provider's list is meaningless
  // once you've switched away from it.
  const [liveModels, setLiveModels] = useState<string[] | null>(null)
  const [modelsFetching, startModelsFetch] = useTransition()
  const [modelsError, setModelsError] = useState<string | null>(null)

  function refreshModels() {
    if (!formRef.current) return
    setModelsError(null)
    const fd = new FormData(formRef.current)
    startModelsFetch(async () => {
      const res = await listModelsAction(null, fd)
      if (res.error) {
        setModelsError(res.error)
      } else if (res.models) {
        setLiveModels(res.models)
        // A live fetch just proved this model ID is real — drop out of
        // free-text mode so it shows in the dropdown like any curated one.
        if (customModel && res.models.includes(chatModel)) setCustomModel(false)
      }
    })
  }

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
          const resolved = resolveChatModel(updated.chat_provider, updated.chat_model)
          setChatModel(resolved.model)
          setCustomModel(resolved.custom)
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
          const resolved = resolveChatModel(data.chat_provider, data.chat_model)
          setChatModel(resolved.model)
          setCustomModel(resolved.custom)
        }
      })
    fetch('/api/ai-config/trial-status')
      .then((r) => r.json())
      .then(setTrialStatus)
  }, [])

  if (config === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const configured = config !== null
  const chatMeta = CHAT_PROVIDERS.find((p) => p.value === chatProvider) ?? CHAT_PROVIDERS[0]
  // Live models (just fetched from the provider itself) win over the
  // hardcoded fallback list whenever they're available.
  const modelOptions = liveModels && liveModels.length > 0 ? liveModels : chatMeta.models
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
                onChange={(e) => {
                  const value = e.target.value
                  setChatProvider(value)
                  // Switching provider invalidates the old model — re-resolve
                  // against the new provider's list rather than keeping a
                  // model ID that belongs to a different vendor.
                  const resolved = resolveChatModel(value)
                  setChatModel(resolved.model)
                  setCustomModel(resolved.custom)
                  // A previous provider's live list is meaningless here.
                  setLiveModels(null)
                  setModelsError(null)
                }}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm bg-white"
              >
                {CHAT_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-600">Model ID</label>
                <button
                  type="button"
                  onClick={refreshModels}
                  disabled={modelsFetching}
                  className="text-xs text-brand-600 hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {modelsFetching ? 'Fetching…' : 'Refresh models'}
                </button>
              </div>
              {liveModels && !modelsError && (
                <p className="text-xs text-green-700 mb-1">Showing {liveModels.length} live model{liveModels.length === 1 ? '' : 's'} from {chatMeta.label}.</p>
              )}
              {modelsError && (
                <p className="text-xs text-amber-600 mb-1 break-words">{modelsError} — showing the built-in list instead.</p>
              )}
              {modelOptions.length > 0 && !customModel ? (
                <select
                  name="chat_model"
                  value={chatModel}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') { setCustomModel(true); setChatModel(''); return }
                    setChatModel(e.target.value)
                  }}
                  className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono bg-white"
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom model ID…</option>
                </select>
              ) : (
                <>
                  <input
                    name="chat_model"
                    type="text"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    placeholder={chatMeta.placeholder}
                    className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    required
                  />
                  {modelOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setCustomModel(false); setChatModel(modelOptions[0]) }}
                      className="text-xs text-brand-600 hover:underline mt-1"
                    >
                      Choose from list instead
                    </button>
                  )}
                </>
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
  const [skillCopied, setSkillCopied] = useState(false)
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

  const operateSkillInstallCommand = `npx @answerloops/agent-sdk skills answerloops-operate`

  function copySkillCommand() {
    navigator.clipboard.writeText(operateSkillInstallCommand).then(() => {
      setSkillCopied(true)
      setTimeout(() => setSkillCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Onboard your agent</p>
            <p className="text-xs text-gray-600 mt-1">
              Install the answerLoops skill so Claude Code can search your knowledge base, read tickets,
              and generate answers against this workspace. Create an API key below first, then drop it
              into the skill&apos;s MCP config.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={copySkillCommand} className="shrink-0">
            {skillCopied ? '✓ Copied' : 'Copy command'}
          </Button>
        </div>
      </div>

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
  { id: 'ai',        label: 'AI Model' },
  { id: 'widget',    label: 'Widget' },
  { id: 'api-keys',  label: 'API Keys' },
  { id: 'danger',    label: 'Danger Zone' },
] as const

type TabId = (typeof TABS)[number]['id']

// Integrations moved to their own page (/integrations) — old bookmarks and
// links using ?tab=<integration> still work, redirected rather than left to
// 404 or silently land on General with no explanation.
const INTEGRATION_TAB_IDS = new Set([
  'discord', 'slack', 'google-chat', 'telegram', 'discourse', 'circle', 'email', 'github', 'notion',
])

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[]>([])

  const tabParam = searchParams.get('tab')
  const activeTab = (tabParam as TabId) ?? 'general'

  const setTab = (id: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', id)
    router.replace(`/settings?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    if (tabParam && INTEGRATION_TAB_IDS.has(tabParam)) {
      router.replace(`/integrations?tab=${tabParam}`)
    }
  }, [tabParam, router])

  useEffect(() => {
    setSlaConfigs([
      { id: 1, priority: 'critical', response_hours: 1, resolve_hours: 4, updated_at: '' },
      { id: 2, priority: 'high', response_hours: 4, resolve_hours: 24, updated_at: '' },
      { id: 3, priority: 'medium', response_hours: 24, resolve_hours: 72, updated_at: '' },
      { id: 4, priority: 'low', response_hours: 72, resolve_hours: 168, updated_at: '' },
    ])
  }, [])

  if (tabParam && INTEGRATION_TAB_IDS.has(tabParam)) return null

  return (
    <div className="dashboard-page max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-600">
          <span className="h-px w-5 bg-blue-500" />
          Workspace configuration
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage AI behavior, team access, and workspace configuration. Connect channels and services under <a href="/integrations" className="text-blue-600 hover:underline">Integrations</a>.</p>
      </div>

      {/* Tab bar */}
      <div className="dashboard-tabs mb-7 flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={[
              'shrink-0 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'bg-[#082e50] text-white shadow-none'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            {tab.label}
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
