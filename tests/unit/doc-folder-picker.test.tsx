// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DocFolderPicker } from '@/components/settings/doc-folder-picker'

// The docs folder picker: lists the repo's folders with docs counts, greys
// out folders with none, pre-ticks the defaults, and saves the ticked paths.

const fetchMock = vi.fn()

function listing(over: Record<string, unknown> = {}) {
  return {
    folders: [
      { path: '.', docFiles: 2, selectable: true },
      { path: 'content', docFiles: 12, selectable: true },
      { path: 'content/docs', docFiles: 12, selectable: true },
      { path: 'src', docFiles: 0, selectable: false },
    ],
    selected: ['content/docs'],
    usingDefaults: true,
    missing: [],
    truncated: false,
    ...over,
  }
}

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open(body = listing()) {
  fetchMock.mockImplementationOnce(() => respond(body))
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  render(<DocFolderPicker repoId={4} onSaved={onSaved} onCancel={onCancel} />)
  await screen.findByRole('checkbox', { name: /content\/docs/ })
  return { onSaved, onCancel }
}

describe('DocFolderPicker', () => {
  it('loads the folder list for the repo', async () => {
    await open()
    expect(fetchMock).toHaveBeenCalledWith('/api/github/repos/4/doc-folders')
    expect(screen.getByText('Repository root (top-level files only)')).toBeTruthy()
    expect(screen.getAllByText('12 files').length).toBeGreaterThan(0)
  })

  it('pre-ticks the defaults and greys an empty folder', async () => {
    await open()
    expect((screen.getByRole('checkbox', { name: /content\/docs/ }) as HTMLInputElement).checked).toBe(true)
    const src = screen.getByRole('checkbox', { name: /^src/ }) as HTMLInputElement
    expect(src.disabled).toBe(true)
    expect(src.checked).toBe(false)
  })

  it('shows a folder inside a ticked folder as included', async () => {
    await open(listing({ selected: ['content'] }))
    const inner = screen.getByRole('checkbox', { name: /content\/docs/ }) as HTMLInputElement
    expect(inner.checked).toBe(true)
    expect(inner.disabled).toBe(true)
  })

  it('saves a ticked parent once, without the folders inside it', async () => {
    await open(listing({ selected: ['content', 'content/docs'] }))
    expect(screen.getByText('(included)')).toBeTruthy()
    fetchMock.mockImplementationOnce(() => respond({ ok: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and sync' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).kbPaths).toEqual(['content'])
  })

  it('lets a saved folder that lost its docs be unticked', async () => {
    await open(listing({ selected: ['src'], usingDefaults: false }))
    const src = screen.getByRole('checkbox', { name: /^src/ }) as HTMLInputElement
    expect(src.checked).toBe(true)
    expect(src.disabled).toBe(false)
  })

  it('asks for fewer folders past the limit', async () => {
    const folders = Array.from({ length: 51 }, (_, k) => ({ path: `d${k}`, docFiles: 1, selectable: true }))
    fetchMock.mockImplementationOnce(() => respond(listing({ folders: [...listing().folders, ...folders], selected: folders.map((f) => f.path) })))
    render(<DocFolderPicker repoId={4} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText('Choose up to 50 folders.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save and sync' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not report back after it has been closed mid-save', async () => {
    let release!: () => void
    fetchMock.mockImplementationOnce(() => respond(listing()))
    const onSaved = vi.fn()
    const { unmount } = render(<DocFolderPicker repoId={4} onSaved={onSaved} onCancel={vi.fn()} />)
    await screen.findByRole('checkbox', { name: /content\/docs/ })
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: true, json: async () => ({ ok: true }) }) }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and sync' }))
    unmount()
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('save posts the ticked paths and reports back', async () => {
    const { onSaved } = await open()
    await userEvent.click(screen.getByRole('checkbox', { name: /Repository root/ }))
    fetchMock.mockImplementationOnce(() => respond({ ok: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and sync' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/github/repo-settings')
    expect(JSON.parse(init.body)).toEqual({ repoId: 4, kbEnabled: 1, kbPaths: ['.', 'content/docs'] })
  })

  it('disables save when nothing is ticked', async () => {
    await open()
    await userEvent.click(screen.getByRole('checkbox', { name: /content\/docs/ }))
    expect((screen.getByRole('button', { name: 'Save and sync' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the error from a failed save and stays open', async () => {
    const { onSaved } = await open()
    fetchMock.mockImplementationOnce(() => respond({ error: 'Choose at least one folder' }, false))
    await userEvent.click(screen.getByRole('button', { name: 'Save and sync' }))
    expect(await screen.findByText('Choose at least one folder')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('says when the repository is too large to list every folder', async () => {
    await open(listing({ truncated: true }))
    expect(screen.getByText('This repository is too large to list every folder.')).toBeTruthy()
  })

  it('names chosen folders that no longer exist and drops them', async () => {
    await open(listing({ selected: ['content/docs', 'guide'], usingDefaults: false, missing: ['guide'] }))
    expect(screen.getByText('guide no longer exists in the repo')).toBeTruthy()
    fetchMock.mockImplementationOnce(() => respond({ ok: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and sync' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).kbPaths).toEqual(['content/docs'])
  })

  it('shows the load error and lets the person cancel', async () => {
    fetchMock.mockImplementationOnce(() => respond({ error: 'Could not read the repository. Try again shortly.' }, false))
    const onCancel = vi.fn()
    render(<DocFolderPicker repoId={4} onSaved={vi.fn()} onCancel={onCancel} />)
    expect(await screen.findByText('Could not read the repository. Try again shortly.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
