'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DiscordIntegrationCard } from '@/components/settings/discord'
import { SlackIntegrationCard } from '@/components/settings/slack'
import { GoogleChatIntegrationCard } from '@/components/settings/googlechat'
import { TelegramIntegrationCard } from '@/components/settings/telegram'
import { DiscourseIntegrationCard } from '@/components/settings/discourse'
import { CircleIntegrationCard } from '@/components/settings/circle'
import { EmailIntegrationCard } from '@/components/settings/email'
import { GitHubIntegrationCard } from '@/components/settings/github'
import { NotionIntegrationCard } from '@/components/settings/notion'
import { INTEGRATIONS, IntegrationsOverview, isIntegrationId, type IntegrationId, type StatusMap } from './overview'

// Maps an integration id to the `platform` value stored on the integrations
// table. These diverge for Google Chat (the id uses a hyphen, the DB value an
// underscore). GitHub and Notion are not here: GitHub's state is per-repo and
// Notion has its own connection, so each is fetched separately.
const PLATFORM: Partial<Record<IntegrationId, string>> = {
  discord: 'discord',
  slack: 'slack',
  'google-chat': 'google_chat',
  telegram: 'telegram',
  discourse: 'discourse',
  circle: 'circle',
  email: 'email',
}

// Platforms whose connected state can be "manual review": the automatic-answers
// switch is off, so answers wait for approval. Circle and Email never show it.
const HAS_REVIEW_STATE = new Set<IntegrationId>(['discord', 'slack', 'google-chat', 'telegram', 'discourse'])

interface IntegrationRow {
  platform: string
  enabled: number
  team_id: string | null
  auto_deflect_enabled: number
}

export default function IntegrationsPage() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const active = isIntegrationId(tabParam) ? tabParam : null
  const [statuses, setStatuses] = useState<StatusMap>({})

  // One fetch per source (not per card), so the overview can show every
  // integration's state before anyone opens one.
  useEffect(() => {
    let cancelled = false
    const merge = (patch: StatusMap) => { if (!cancelled) setStatuses((prev) => ({ ...prev, ...patch })) }
    const unknown = (ids: IntegrationId[]): StatusMap =>
      Object.fromEntries(ids.map((id) => [id, { connected: false, manualReview: false }]))

    fetch('/api/integrations')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: IntegrationRow[]) => {
        const patch: StatusMap = {}
        for (const [id, platform] of Object.entries(PLATFORM) as [IntegrationId, string][]) {
          const row = Array.isArray(rows) ? rows.find((r) => r.platform === platform) : undefined
          // A row can exist (a half-finished Google Chat pairing, say) without
          // the integration being connected, so match each card's own check:
          // enabled, plus a team id for the platforms that need one.
          const needsTeam = platform === 'google_chat' || platform === 'discourse' || platform === 'circle'
          const connected = row != null && row.enabled === 1 && (!needsTeam || !!row.team_id)
          patch[id] = { connected, manualReview: connected && HAS_REVIEW_STATE.has(id) && row.auto_deflect_enabled !== 1 }
        }
        merge(patch)
      })
      .catch(() => merge(unknown(Object.keys(PLATFORM) as IntegrationId[])))

    fetch('/api/github/repos')
      .then((res) => (res.ok ? res.json() : []))
      .then((repos: { auto_deflect_enabled: number }[]) => {
        const list = Array.isArray(repos) ? repos : []
        merge({ github: { connected: list.length > 0, manualReview: list.length > 0 && !list.some((r) => r.auto_deflect_enabled === 1) } })
      })
      .catch(() => merge(unknown(['github'])))

    fetch('/api/notion')
      .then((res) => (res.ok ? res.json() : { connection: null }))
      .then((body: { connection?: unknown }) => merge({ notion: { connected: !!body?.connection, manualReview: false } }))
      .catch(() => merge(unknown(['notion'])))

    return () => { cancelled = true }
  }, [])

  const activeInfo = INTEGRATIONS.find((i) => i.id === active)

  return (
    <div className="dashboard-page max-w-6xl">
      <div className="mb-6">
        {activeInfo ? (
          <Link
            href="/integrations"
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            <span aria-hidden="true">←</span> All integrations
          </Link>
        ) : (
          <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-600">
            <span className="h-px w-5 bg-blue-500" />
            Workspace configuration
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">
          {activeInfo ? activeInfo.label : 'Integrations'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {activeInfo ? activeInfo.description : 'Connect the channels and services this workspace answers questions in.'}
        </p>
      </div>

      {!active && <IntegrationsOverview statuses={statuses} />}

      {active === 'discord' && <DiscordIntegrationCard />}
      {active === 'slack' && <SlackIntegrationCard />}
      {active === 'google-chat' && <GoogleChatIntegrationCard />}
      {active === 'telegram' && <TelegramIntegrationCard />}
      {active === 'discourse' && <DiscourseIntegrationCard />}
      {active === 'circle' && <CircleIntegrationCard />}
      {active === 'email' && <EmailIntegrationCard />}
      {active === 'github' && <GitHubIntegrationCard />}
      {active === 'notion' && <NotionIntegrationCard />}
    </div>
  )
}
