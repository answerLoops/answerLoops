'use client'

import Link from 'next/link'

export type IntegrationId =
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'github'
  | 'notion'
  | 'discourse'
  | 'google-chat'
  | 'circle'
  | 'email'

interface IntegrationInfo {
  id: IntegrationId
  label: string
  description: string
  /** Available, but has seen little real-world use. */
  beta: boolean
  /** Where answers go (a channel), or where knowledge comes from (a source). */
  kind: 'channel' | 'source'
  /** Tailwind classes for the letter avatar. */
  avatar: string
}

export const INTEGRATIONS: readonly IntegrationInfo[] = [
  { id: 'discord', label: 'Discord', kind: 'channel', beta: false, avatar: 'bg-indigo-100 text-indigo-700', description: 'Answer questions in your Discord server.' },
  { id: 'slack', label: 'Slack', kind: 'channel', beta: false, avatar: 'bg-purple-100 text-purple-700', description: 'Answer questions in the channels you choose.' },
  { id: 'telegram', label: 'Telegram', kind: 'channel', beta: false, avatar: 'bg-sky-100 text-sky-700', description: 'Answer questions in the Telegram chats you choose.' },
  { id: 'discourse', label: 'Discourse', kind: 'channel', beta: false, avatar: 'bg-amber-100 text-amber-700', description: 'Answer questions on your Discourse forum.' },
  { id: 'google-chat', label: 'Google Chat', kind: 'channel', beta: true, avatar: 'bg-emerald-100 text-emerald-700', description: 'Answer questions in your Google Chat spaces.' },
  { id: 'circle', label: 'Circle', kind: 'channel', beta: true, avatar: 'bg-violet-100 text-violet-700', description: 'Answer posts and comments in your Circle community.' },
  { id: 'email', label: 'Email', kind: 'channel', beta: true, avatar: 'bg-rose-100 text-rose-700', description: 'Turn emails to your support address into tickets and reply from your mailbox.' },
  { id: 'github', label: 'GitHub', kind: 'source', beta: false, avatar: 'bg-slate-200 text-slate-800', description: 'Turn Issues and Discussions into tickets, and sync repo docs into the knowledge base.' },
  { id: 'notion', label: 'Notion', kind: 'source', beta: false, avatar: 'bg-slate-900 text-white', description: 'Sync Notion pages into the knowledge base.' },
]

export function isIntegrationId(value: string | null): value is IntegrationId {
  return INTEGRATIONS.some((i) => i.id === value)
}

/**
 * What the overview shows for one integration. `connected` is null until the
 * status is known, so a card never claims "Not connected" while still loading.
 * `manualReview` is set for a connected channel whose automatic replies are off.
 */
export interface IntegrationStatus {
  connected: boolean | null
  manualReview: boolean
}

export type StatusMap = Partial<Record<IntegrationId, IntegrationStatus>>

function StatusBadge({ status }: { status: IntegrationStatus | undefined }) {
  if (!status || status.connected === null) {
    return <span className="h-5 w-16 animate-pulse rounded-full bg-slate-100" aria-hidden="true" />
  }
  if (!status.connected) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-500">Not connected</span>
  }
  return (
    <span className="flex items-center gap-1.5">
      {status.manualReview && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-800">Manual review</span>
      )}
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.6875rem] font-medium text-emerald-700">Connected</span>
    </span>
  )
}

function IntegrationCard({ info, status }: { info: IntegrationInfo; status: IntegrationStatus | undefined }) {
  const connected = status?.connected === true
  return (
    <li className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${info.avatar}`} aria-hidden="true">
          {info.label[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-slate-900">{info.label}</h3>
            {info.beta && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-blue-700">Beta</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{info.description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={status} />
        <Link
          href={`/integrations?tab=${info.id}`}
          aria-label={`${connected ? 'Manage' : 'Connect'} ${info.label}`}
          className={
            connected
              ? 'rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50'
              : 'rounded-lg bg-[#082e50] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0b3d6b]'
          }
        >
          {connected ? 'Manage' : 'Connect'}
        </Link>
      </div>
    </li>
  )
}

function Section({ title, hint, kind, statuses }: { title: string; hint: string; kind: IntegrationInfo['kind']; statuses: StatusMap }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.filter((i) => i.kind === kind).map((info) => (
          <IntegrationCard key={info.id} info={info} status={statuses[info.id]} />
        ))}
      </ul>
    </section>
  )
}

/** The Integrations landing view: every integration, its status, one button. */
export function IntegrationsOverview({ statuses }: { statuses: StatusMap }) {
  return (
    <div className="space-y-8">
      <Section title="Channels" hint="Where answerLoops answers questions." kind="channel" statuses={statuses} />
      <Section title="Knowledge sources" hint="Where answerLoops learns from, and can also take tickets." kind="source" statuses={statuses} />
    </div>
  )
}
