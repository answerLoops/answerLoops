// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatsCards } from '@/components/dashboard/stats-cards'

const stats = {
  total: 100,
  open: 12,
  inProgress: 8,
  resolved: 30,
  slaBreaches: 2,
  pendingDrafts: 3,
  needsReview: 4,
  autoDeflected: 50,
  // Deliberately not autoDeflected / total, which would be 50.
  deflectionRate: 75,
}

describe('StatsCards', () => {
  it.each([12, 0])('links the entire Open card to open tickets when the count is %i', (open) => {
    render(<StatsCards {...stats} open={open} />)

    const link = screen.getByRole('link', { name: new RegExp(`^Open\\s+${open}$`) })
    expect(link).toHaveAttribute('href', '/tickets?status=open')
    expect(within(link).getByText('Open')).toBeVisible()
    expect(within(link).getByText(String(open))).toBeVisible()
  })

  it.each([
    ['In Progress', 8, '/tickets?status=in_progress'],
    ['Resolved', 30, '/tickets?status=resolved'],
  ])('links the entire %s card to its filtered tickets', (label, count, href) => {
    render(<StatsCards {...stats} />)

    const link = screen.getByRole('link', { name: new RegExp(`^${label}\\s+${count}$`) })
    expect(link).toHaveAttribute('href', href)
    expect(within(link).getByText(label)).toBeVisible()
    expect(within(link).getByText(String(count))).toBeVisible()
  })

  it.each([
    ['Auto-Answered', 50, '/tickets?autoDeflected=1'],
    ['Deflection Rate', '75%', '/analytics'],
    ['Needs Review', 4, '/tickets?needsReview=1'],
    ['AI Drafts Pending', 3, '/tickets?pendingDraft=1'],
    ['SLA Breaches', 2, '/tickets?slaBreached=1'],
  ])('links the entire %s card to its relevant view', (label, count, href) => {
    render(<StatsCards {...stats} />)

    const link = screen.getByRole('link', { name: new RegExp(`^${label}\\s+${count}$`) })
    expect(link).toHaveAttribute('href', href)
    expect(within(link).getByText(label)).toBeVisible()
    expect(within(link).getByText(String(count))).toBeVisible()
  })

  it('makes all eight stat cards keyboard-accessible links', async () => {
    const user = userEvent.setup()
    render(<StatsCards {...stats} />)

    expect(screen.getAllByRole('link')).toHaveLength(8)
    for (const label of [
      'Auto-Answered', 'Deflection Rate', 'Open', 'In Progress',
      'Resolved', 'Needs Review', 'AI Drafts Pending', 'SLA Breaches',
    ]) {
      expect(screen.getByText(label).closest('a')).not.toBeNull()
    }

    await user.tab()
    expect(screen.getByRole('link', { name: /^Auto-Answered\s+50$/ })).toHaveFocus()
  })

  it('allows keyboard focus and Enter activation of the Open link', async () => {
    const user = userEvent.setup()
    render(<StatsCards {...stats} />)
    const link = screen.getByRole('link', { name: /^Open\s+12$/ })
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
