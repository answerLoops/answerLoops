// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSearchParams } from 'next/navigation'

/**
 * The Settings tab bar: which tabs exist, which panel each opens, and where old
 * links land. The sections themselves are covered by their own tests, so they
 * are stubbed to a label here.
 */

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace: nav.replace }),
}))
vi.mock('@/components/settings/general', () => ({ GeneralSection: () => <div>general-panel</div> }))
vi.mock('@/components/settings/team', () => ({ TeamSection: () => <div>team-panel</div> }))
vi.mock('@/components/settings/ai-model', () => ({ AIModelSection: () => <div>ai-model-panel</div> }))
vi.mock('@/components/settings/widget', () => ({ WidgetSection: () => <div>widget-panel</div> }))
vi.mock('@/components/settings/api-keys', () => ({ ApiKeysSection: () => <div>api-keys-panel</div> }))
vi.mock('@/components/settings/danger-zone', () => ({ DangerZoneSection: () => <div>danger-panel</div> }))
vi.mock('@/components/settings/source-support', () => ({ SourceSupportSection: () => <div>source-support-panel</div> }))
vi.mock('@/components/settings/kb-page-titles', () => ({ KbPageTitlesSection: () => <div>page-titles-panel</div> }))

import SettingsPage from '@/app/(dashboard)/settings/page'

function at(tab: string | null) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(tab ? { tab } : {}) as unknown as ReturnType<typeof useSearchParams>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
})

describe('Settings tabs', () => {
  it('has six tabs, with Source support folded into AI Model', () => {
    at(null)
    render(<SettingsPage />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Team', 'AI Model', 'Widget', 'API Keys', 'Danger Zone'])
  })

  it('opens General by default and for an unknown tab', () => {
    at(null)
    const { unmount } = render(<SettingsPage />)
    expect(screen.getByText('general-panel')).toBeInTheDocument()
    unmount()
    at('nope')
    render(<SettingsPage />)
    expect(screen.getByText('general-panel')).toBeInTheDocument()
  })

  it.each([
    ['team', 'team-panel'],
    ['widget', 'widget-panel'],
    ['api-keys', 'api-keys-panel'],
    ['danger', 'danger-panel'],
  ])('?tab=%s opens its panel and marks the tab selected', (tab, panel) => {
    at(tab)
    render(<SettingsPage />)
    expect(screen.getByText(panel)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })

  it('shows the model, imported page titles and source support together under AI Model', () => {
    at('ai')
    render(<SettingsPage />)
    for (const panel of ['ai-model-panel', 'page-titles-panel', 'source-support-panel']) {
      expect(screen.getByText(panel)).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: 'AI Model' })).toHaveAttribute('aria-selected', 'true')
  })

  it('sends an old ?tab=source-support link to AI Model', () => {
    at('source-support')
    render(<SettingsPage />)
    expect(screen.getByText('source-support-panel')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI Model' })).toHaveAttribute('aria-selected', 'true')
  })

  it.each(['github', 'discord', 'notion', 'google-chat'])('redirects the old ?tab=%s link to Integrations', (tab) => {
    at(tab)
    const { container } = render(<SettingsPage />)
    expect(container.firstChild).toBeNull()
    expect(nav.replace).toHaveBeenCalledWith(`/integrations?tab=${tab}`)
  })

  it('links to Integrations from the page intro', () => {
    at(null)
    render(<SettingsPage />)
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute('href', '/integrations')
  })
})
