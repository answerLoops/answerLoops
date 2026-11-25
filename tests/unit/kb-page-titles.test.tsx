// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * "Update imported page titles" in Settings → AI Model: shown only to a
 * workspace on its own embedding key (or self-hosted) with pages waiting, and
 * it keeps calling the action until every page is done or something fails.
 */

const h = vi.hoisted(() => ({ retitleStatusAction: vi.fn(), runRetitleAction: vi.fn() }))
vi.mock('@/lib/actions/kb-retitle', () => ({ retitleStatusAction: h.retitleStatusAction, runRetitleAction: h.runRetitleAction }))

import { KbPageTitlesSection } from '@/components/settings/kb-page-titles'

beforeEach(() => {
  vi.clearAllMocks()
  h.retitleStatusAction.mockResolvedValue({ eligibleForOwnerRun: true, remainingSources: 12 })
})

describe('KbPageTitlesSection', () => {
  it('explains the update and offers it when pages are waiting', async () => {
    render(<KbPageTitlesSection />)
    expect(await screen.findByText('Update imported page titles')).toBeTruthy()
    expect(screen.getByText(/re-processes those sections with your embedding key/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update titles' })).toBeTruthy()
  })

  it('shows nothing when the workspace is updated automatically', async () => {
    h.retitleStatusAction.mockResolvedValue({ eligibleForOwnerRun: false, remainingSources: 12 })
    const { container } = render(<KbPageTitlesSection />)
    await waitFor(() => expect(h.retitleStatusAction).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('shows nothing when no pages are waiting', async () => {
    h.retitleStatusAction.mockResolvedValue({ eligibleForOwnerRun: true, remainingSources: 0 })
    const { container } = render(<KbPageTitlesSection />)
    await waitFor(() => expect(h.retitleStatusAction).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('keeps going until every page is done, showing what is left, then confirms', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    h.runRetitleAction
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ ok: true, retitled: 7, remainingSources: 0 })
    const user = userEvent.setup()
    render(<KbPageTitlesSection />)
    const status = await screen.findByRole('status')
    await user.click(await screen.findByRole('button', { name: 'Update titles' }))
    // One live region, there from the start, whose text changes: announced once.
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Updating… 12 pages left. Keep this page open until it finishes.')
    expect((screen.getByRole('button', { name: 'Update titles' }) as HTMLButtonElement).disabled).toBe(true)
    resolveFirst({ ok: true, retitled: 9, remainingSources: 2 })
    await waitFor(() => expect(status.textContent).toBe('Titles updated.'))
    expect(h.runRetitleAction).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Update titles' })).toBeNull()
  })

  it('stops at the first error and shows it, leaving the button to try again', async () => {
    h.runRetitleAction
      .mockResolvedValueOnce({ ok: true, retitled: 3, remainingSources: 5 })
      .mockResolvedValueOnce({ ok: false, error: 'An update is already running. Try again in a few minutes.' })
    const user = userEvent.setup()
    render(<KbPageTitlesSection />)
    await user.click(await screen.findByRole('button', { name: 'Update titles' }))
    expect(await screen.findByText('An update is already running. Try again in a few minutes.')).toBeTruthy()
    expect(h.runRetitleAction).toHaveBeenCalledTimes(2)
    expect((screen.getByRole('button', { name: 'Update titles' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('treats a failed request as an error rather than spinning', async () => {
    h.runRetitleAction.mockRejectedValueOnce(new Error('network'))
    const user = userEvent.setup()
    render(<KbPageTitlesSection />)
    await user.click(await screen.findByRole('button', { name: 'Update titles' }))
    expect(await screen.findByText('The update could not be reached. Try again.')).toBeTruthy()
  })
})
