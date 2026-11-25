'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import type { SLAConfig } from '@/types'
import { GeneralSection } from '@/components/settings/general'
import { TeamSection } from '@/components/settings/team'
import { AIModelSection } from '@/components/settings/ai-model'
import { WidgetSection } from '@/components/settings/widget'
import { ApiKeysSection } from '@/components/settings/api-keys'
import { DangerZoneSection } from '@/components/settings/danger-zone'
import { SourceSupportSection } from '@/components/settings/source-support'
import { KbPageTitlesSection } from '@/components/settings/kb-page-titles'

const TABS = [
  { id: 'general',   label: 'General' },
  { id: 'team',      label: 'Team' },
  { id: 'ai',        label: 'AI Model' },
  { id: 'widget',    label: 'Widget' },
  { id: 'api-keys',  label: 'API Keys' },
  { id: 'danger',    label: 'Danger Zone' },
] as const

type TabId = (typeof TABS)[number]['id']

// Source support used to be its own tab. It is about how answers are checked
// against the knowledge base, so it now sits under AI Model. Old links to
// ?tab=source-support land there rather than on General.
const RENAMED_TABS: Record<string, TabId> = { 'source-support': 'ai' }

// Integrations moved to their own page (/integrations) — old bookmarks and
// links using ?tab=<integration> still work, redirected rather than left to
// 404 or silently land on General with no explanation.
const INTEGRATION_TAB_IDS = new Set([
  'discord', 'slack', 'google-chat', 'telegram', 'discourse', 'circle', 'email', 'github', 'notion',
])

function resolveTab(param: string | null): TabId {
  if (param && param in RENAMED_TABS) return RENAMED_TABS[param]
  return TABS.some((t) => t.id === param) ? (param as TabId) : 'general'
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[] | null>(null)

  const tabParam = searchParams.get('tab')
  const activeTab = resolveTab(tabParam)

  const setTab = (id: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', id)
    router.replace(`/settings?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    fetch('/api/sla')
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => { if (Array.isArray(rows)) setSlaConfigs(rows) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (tabParam && INTEGRATION_TAB_IDS.has(tabParam)) {
      router.replace(`/integrations?tab=${tabParam}`)
    }
  }, [tabParam, router])

  if (tabParam && INTEGRATION_TAB_IDS.has(tabParam)) return null

  return (
    <div className="dashboard-page max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-600">
          <span className="h-px w-5 bg-blue-500" />
          Workspace configuration
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage AI behavior, team access, and workspace configuration. Connect channels and services under{' '}
          <Link href="/integrations" className="text-blue-600 hover:underline">Integrations</Link>.
        </p>
      </div>

      {/* Tab bar */}
      <div className="dashboard-tabs mb-7 flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
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
      {activeTab === 'general' && <GeneralSection slaConfigs={slaConfigs} />}

      {activeTab === 'team' && (
        <section>
          <TeamSection />
        </section>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-8">
          <AIModelSection />
          <KbPageTitlesSection />
          <SourceSupportSection />
        </div>
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
