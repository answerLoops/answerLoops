'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { DiscordIntegrationCard } from '@/components/settings/discord'
import { SlackIntegrationCard } from '@/components/settings/slack'
import { GoogleChatIntegrationCard } from '@/components/settings/googlechat'
import { TelegramIntegrationCard } from '@/components/settings/telegram'
import { DiscourseIntegrationCard } from '@/components/settings/discourse'
import { CircleIntegrationCard } from '@/components/settings/circle'
import { EmailIntegrationCard } from '@/components/settings/email'
import { GitHubIntegrationCard } from '@/components/settings/github'
import { NotionIntegrationCard } from '@/components/settings/notion'

const TABS = [
  { id: 'discord',     label: 'Discord' },
  { id: 'slack',       label: 'Slack' },
  { id: 'google-chat', label: 'Google Chat' },
  { id: 'telegram',    label: 'Telegram' },
  { id: 'discourse',   label: 'Discourse' },
  { id: 'circle',      label: 'Circle' },
  { id: 'email',       label: 'Email' },
  { id: 'github',      label: 'GitHub' },
  { id: 'notion',      label: 'Notion' },
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

export default function IntegrationsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [deflectionDots, setDeflectionDots] = useState<DeflectionDotState>({})

  const activeTab = (searchParams.get('tab') as TabId) ?? 'discord'

  const setTab = (id: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', id)
    router.replace(`/integrations?${params.toString()}`, { scroll: false })
  }

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
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">Integrations</h1>
        <p className="mt-1 text-sm text-slate-500">Connect the channels and services this workspace answers questions in.</p>
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
    </div>
  )
}
