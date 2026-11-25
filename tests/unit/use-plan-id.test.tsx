// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { resetPlanIdCache, usePlanId } from '@/components/billing/use-plan-id'

const fetchMock = vi.fn()

function Probe({ id }: { id: string }) {
  return <span data-testid={id}>{usePlanId() ?? 'none'}</span>
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPlanIdCache()
  vi.stubGlobal('fetch', fetchMock)
})

describe('usePlanId', () => {
  it('reads the plan once, however many components ask', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ planId: 'pro' }) })
    render(<><Probe id="a" /><Probe id="b" /></>)
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('pro'))
    expect(screen.getByTestId('b')).toHaveTextContent('pro')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/status')
  })

  it('is null when the response has no plan', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({}) })
    render(<Probe id="a" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('a')).toHaveTextContent('none')
  })

  it('is null when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<Probe id="a" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('a')).toHaveTextContent('none')
  })
})
