// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

import { GitHubIntegrationCard } from '@/components/settings/github'

// Turning Knowledge Base on for a repo opens the docs folder picker first;
// the repo is only switched on when the owner saves. Sync now queues a job.

const fetchMock = vi.fn()

function repo(over: Record<string, unknown> = {}) {
  return {
    id: 4, org_id: 7, installation_id: 1, owner: 'acme', repo: 'docs', is_private: 0, monitored_events: 'both',
    kb_enabled: 0, kb_last_synced: null, kb_synced_commit: null, kb_chunk_count: 0, kb_paths: null, kb_sync_result: null,
    auto_deflect_enabled: 0, added_at: '2026-11-23T00:00:00Z', ...over,
  }
}

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body })

function route(repos: unknown[], over: { syncKb?: () => Promise<unknown>; job?: unknown; settings?: () => Promise<unknown> } = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/github/repos') return json(repos)
    if (url.startsWith('/api/github/sync-kb') && over.syncKb) return over.syncKb()
    if (url.startsWith('/api/kb/sync-jobs') && over.job) return json(over.job)
    if (url === '/api/github/repo-settings' && over.settings) return over.settings()
    if (url === '/api/github/repos/4/doc-folders') {
      return json({ folders: [{ path: 'docs', docFiles: 3, selectable: true }], selected: ['docs'], usingDefaults: true, missing: [], truncated: false })
    }
    if (url.startsWith('/api/github/sync-kb')) return json({ jobId: 1, status: 'queued' })
    if (url.startsWith('/api/kb/sync-jobs')) return json({ status: 'succeeded', detail: 'Synced 3 docs files and 0 discussion chunks', syncedCount: 3 })
    if (url === '/api/github/repo-settings') return json({ ok: true, echo: init?.body })
    return json({})
  })
}

const posts = (url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u.startsWith(url) && (init as RequestInit | undefined)?.method === 'POST')

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GitHubIntegrationCard — Automatic Deflections row on small screens', () => {
  it('stacks the label above its badge and button on phones, side by side from the small breakpoint', async () => {
    route([repo()])
    render(<GitHubIntegrationCard />)
    const badge = await screen.findByText('Automatic Deflections: Off')
    const controls = badge.parentElement as HTMLElement
    const row = controls.parentElement as HTMLElement
    expect(row.className).toMatch(/(^|\s)flex-col(\s|$)/)
    expect(row.className).toMatch(/sm:flex-row/)
    // The controls wrap instead of squeezing the description beside them.
    expect(controls.className).toMatch(/(^|\s)flex-wrap(\s|$)/)
    expect(controls.className).not.toMatch(/(^|\s)shrink-0(\s|$)/)
    expect(controls.className).toMatch(/sm:shrink-0/)
  })
})

describe('GitHubIntegrationCard — removing a repo', () => {
  it('shows the reason when removing is refused', async () => {
    route([repo()])
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/github/repos/4' && init?.method === 'DELETE'
        ? json({ error: 'You do not have permission to do that.' }, false)
        : base(url, init)
    )
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('You do not have permission to do that.')
  })
})

describe('GitHubIntegrationCard — knowledge base', () => {
  it('cancel leaves knowledge base off', async () => {
    route([repo()])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: /Set up Knowledge Base/ }))
    expect(await screen.findByRole('button', { name: 'Save and sync' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save and sync' })).toBeNull()
    expect(screen.getByRole('button', { name: /Set up Knowledge Base/ })).toBeTruthy()
    expect(posts('/api/github/repo-settings')).toHaveLength(0)
  })

  it('saving the picker switches the repo on and starts a sync', async () => {
    route([repo()])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: /Set up Knowledge Base/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save and sync' }))
    await waitFor(() => expect(posts('/api/github/sync-kb')).toHaveLength(1))
    expect(JSON.parse(posts('/api/github/repo-settings')[0][1].body)).toEqual({ repoId: 4, kbEnabled: 1, kbPaths: ['docs'] })
  })

  it('turning knowledge base off saves straight away', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'] })])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Knowledge Base/ }))
    await waitFor(() => expect(posts('/api/github/repo-settings')).toHaveLength(1))
    expect(JSON.parse(posts('/api/github/repo-settings')[0][1].body)).toEqual({ repoId: 4, kbEnabled: 0 })
  })

  it('Change folders opens the picker for an enabled repo', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'] })])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Change folders' }))
    expect(await screen.findByRole('button', { name: 'Save and sync' })).toBeTruthy()
  })

  it('names the repo in the result and announces it', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'], kb_chunk_count: 3 })])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('acme/docs: Synced 3 docs files')
  })

  it('shows a failed sync as an error, not a success', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'], kb_chunk_count: 3 })], {
      syncKb: () => json({ error: 'Rate limit reached. Try again in 2 minutes.' }, false),
    })
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('acme/docs: Rate limit reached. Try again in 2 minutes.')
  })

  it('keeps each repo\'s sync button busy on its own', async () => {
    let release!: () => void
    route(
      [repo({ kb_enabled: 1, kb_paths: ['docs'], kb_chunk_count: 3 }), repo({ id: 5, repo: 'sdk', kb_enabled: 1, kb_paths: ['docs'], kb_chunk_count: 3 })],
      { syncKb: () => new Promise((r) => { release = () => r({ ok: true, json: async () => ({ jobId: 1 }) }) }) }
    )
    render(<GitHubIntegrationCard />)
    const buttons = await screen.findAllByRole('button', { name: 'Sync now' })
    await userEvent.click(buttons[0])
    // The first repo is busy; the second repo's button is untouched.
    expect(screen.getAllByRole('button', { name: 'Sync now' })).toHaveLength(1)
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false)
    release()
  })

  it('locks the Knowledge Base box while folders are being saved', async () => {
    let release!: () => void
    route([repo({ kb_enabled: 1, kb_paths: ['docs'] })], { settings: () => new Promise((r) => { release = () => r({ ok: true, json: async () => ({ ok: true }) }) }) })
    render(<GitHubIntegrationCard />)
    const box = (await screen.findByRole('checkbox', { name: /Knowledge Base/ })) as HTMLInputElement
    expect(box.checked).toBe(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Change folders' }))
    await userEvent.click(await screen.findByRole('button', { name: /Save and sync/ }))
    await waitFor(() => expect(box.disabled).toBe(true))
    release()
  })

  it('shows no checkbox and no "Off" label until Knowledge Base is on', async () => {
    route([repo()])
    render(<GitHubIntegrationCard />)
    await screen.findByRole('button', { name: /Set up Knowledge Base/ })
    expect(screen.queryByRole('checkbox', { name: /Knowledge Base/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Set up Knowledge Base/ }))
    await screen.findByRole('button', { name: 'Save and sync' })
    expect(screen.queryByRole('checkbox', { name: /Knowledge Base/ })).toBeNull()
    expect(screen.queryByText('Choosing folders')).toBeNull()
    expect(posts('/api/github/repo-settings')).toHaveLength(0)
  })

  it('opens the picker in a dialog, moves focus into it and back when it closes', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'] })])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Change folders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Docs folders' })
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Change folders'))
  })

  it('closes the picker dialog with Escape', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'] })])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Change folders' }))
    await screen.findByRole('dialog', { name: 'Docs folders' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Change folders'))
  })

  it('returns focus to Choose folders when the picker is cancelled on a repo that is off', async () => {
    route([repo()])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: /Set up Knowledge Base/ }))
    await screen.findByRole('button', { name: 'Save and sync' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Choose folders'))
  })

  it('hides Choose folders while the picker is open', async () => {
    route([repo()])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: /Set up Knowledge Base/ }))
    await screen.findByRole('button', { name: 'Save and sync' })
    expect(screen.queryByRole('button', { name: /Set up Knowledge Base/ })).toBeNull()
  })

  it('Sync now sends a POST and shows the result', async () => {
    route([repo({ kb_enabled: 1, kb_paths: ['docs'], kb_chunk_count: 3 })])
    render(<GitHubIntegrationCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(posts('/api/github/sync-kb?repo_id=4')).toHaveLength(1))
    expect(await screen.findByText(/Synced 3 docs files/)).toBeTruthy()
  })
})
