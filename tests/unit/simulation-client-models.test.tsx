// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SimulationClient from '@/app/(dashboard)/simulation/simulation-client'

// On hosted, a workspace without its own provider runs simulation on the
// included chat model, so the picker shows only that model, locked. Choosing
// another needs the workspace's own provider. Self-hosted keeps its choice of
// models on its own .env key.

describe('SimulationClient model picker', () => {
  it('hosted without an own key: only the included model, locked, with a pointer to settings', () => {
    render(<SimulationClient configuredProvider={null} configuredModel={null} includedModel="gpt-5.6-terra" />)
    const select = screen.getByRole('combobox', { name: /model/i })
    expect(select).toBeDisabled()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['gpt-5.6-terra'])
    expect(screen.getByText(/Included model\. Add your own provider in Settings → AI Model to choose another\./)).toBeInTheDocument()
  })

  it('own provider: its models, selectable', () => {
    render(<SimulationClient configuredProvider="anthropic" configuredModel="claude-sonnet-4-6" includedModel={null} />)
    const select = screen.getByRole('combobox', { name: /model/i })
    expect(select).toBeEnabled()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1)
    expect(screen.queryByText(/Included model/)).not.toBeInTheDocument()
  })

  it('self-hosted without an own key: the platform key with a choice of models', () => {
    render(<SimulationClient configuredProvider={null} configuredModel={null} includedModel={null} />)
    expect(screen.getByRole('combobox', { name: /model/i })).toBeEnabled()
    expect(screen.getByText(/No AI provider connected/)).toBeInTheDocument()
  })

  describe('running a simulation', () => {
    const realFetch = global.fetch
    afterEach(() => {
      global.fetch = realFetch
    })

    // A run that never finishes keeps the client in its running state.
    function pendingRunFetch() {
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
      global.fetch = fetchMock as unknown as typeof fetch
      return fetchMock
    }

    it('submits the included model in the run request', async () => {
      const fetchMock = pendingRunFetch()
      const user = userEvent.setup()
      render(<SimulationClient configuredProvider={null} configuredModel={null} includedModel="gpt-5.6-terra" />)

      await user.click(screen.getByRole('button', { name: 'Run simulation' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('/api/simulation/run')
      expect(JSON.parse(String(init.body)).model).toBe('gpt-5.6-terra')
    })

    it('locks the picker for an own-provider workspace while a run is in progress', async () => {
      pendingRunFetch()
      const user = userEvent.setup()
      render(<SimulationClient configuredProvider="anthropic" configuredModel="claude-sonnet-4-6" includedModel={null} />)
      const select = screen.getByRole('combobox', { name: /model/i })
      expect(select).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Run simulation' }))

      expect(await screen.findByRole('button', { name: 'Running simulation…' })).toBeDisabled()
      expect(select).toBeDisabled()
    })
  })
})
