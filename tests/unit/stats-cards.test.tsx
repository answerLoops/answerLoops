// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatsCards } from '@/components/dashboard/stats-cards'

const stats = {
  open: 12,
  inProgress: 8,
  resolved: 30,
  autoDeflected: 50,
  // Deliberately not autoDeflected / total, which would be 50.
  deflectionRate: 75,
}

describe('StatsCards', () => {
  it('links the entire Open card to open tickets and notes how many are in progress', () => {
    render(<StatsCards {...stats} />)

    const link = screen.getByRole('link', { name: /^Open\s+12\s+8 in progress$/ })
    expect(link).toHaveAttribute('href', '/tickets?status=open')
    expect(within(link).getByText('Open')).toBeVisible()
    expect(within(link).getByText('12')).toBeVisible()
    expect(within(link).getByText('8 in progress')).toBeVisible()
  })

  it.each([12, 0])('links the Open card to open tickets when the count is %i', (open) => {
    render(<StatsCards {...stats} open={open} inProgress={0} />)

    const link = screen.getByRole('link', { name: new RegExp(`^Open\\s+${open}$`) })
    expect(link).toHaveAttribute('href', '/tickets?status=open')
    expect(screen.queryByText(/in progress/)).toBeNull()
  })

  it.each([
    ['Auto-Answered', 50, '/tickets?autoDeflected=1'],
    ['Deflection Rate', '75%', '/analytics'],
    ['Resolved', 30, '/tickets?status=resolved'],
  ])('links the entire %s card to its relevant view', (label, count, href) => {
    render(<StatsCards {...stats} />)

    const link = screen.getByRole('link', { name: new RegExp(`^${label}\\s+${count}$`) })
    expect(link).toHaveAttribute('href', href)
    expect(within(link).getByText(label)).toBeVisible()
    expect(within(link).getByText(String(count))).toBeVisible()
  })

  it('shows only four cards; counts that need a decision live in the Needs attention list', () => {
    render(<StatsCards {...stats} />)

    expect(screen.getAllByRole('link')).toHaveLength(4)
    for (const label of ['Auto-Answered', 'Deflection Rate', 'Open', 'Resolved']) {
      expect(screen.getByText(label).closest('a')).not.toBeNull()
    }
    for (const label of ['SLA Breaches', 'Needs Review', 'AI Drafts Pending', 'In Progress']) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })

  it('allows keyboard focus and Enter activation of the Open link', async () => {
    const user = userEvent.setup()
    render(<StatsCards {...stats} />)
    const link = screen.getByRole('link', { name: /^Open\s+12/ })
    // Keep the real Link and its browser semantics; intercept only navigation
    // because this component test has no running application router.
    const activate = vi.fn((event: Event) => event.preventDefault())
    link.addEventListener('click', activate)

    await user.tab() // Auto-Answered
    await user.tab() // Deflection Rate
    await user.tab() // Open
    expect(link).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0][0].target).toBe(link)
    expect(link).toHaveAttribute('href', '/tickets?status=open')
  })
})
