'use client'

import { useState,useEffect,useActionState,useRef,useTransition } from 'react'
import { useSearchParams,useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeflectionStatusBadge } from '@/components/ui/badge'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'
import { saveEmailIntegrationAction,deleteEmailIntegrationAction,startEmailDomainVerificationAction,checkEmailDomainVerificationAction,removeEmailDomainAction,disconnectOauthAction } from '@/app/actions/integrations'

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

