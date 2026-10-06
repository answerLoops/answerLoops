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
}

describe('StatsCards', () => {
  it.each([12, 0])('links the entire Open card to open tickets when the count is %i', (open) => {
    render(<StatsCards {...stats} open={open} />)

    const link = screen.getByRole('link', { name: new RegExp(`^Open\\s+${open}$`) })
    expect(link).toHaveAttribute('href', '/tickets?status=open')
    expect(within(link).getByText('Open')).toBeVisible()
    expect(within(link).getByText(String(open))).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('keeps all other metrics noninteractive and out of the tab order', async () => {
    const user = userEvent.setup()
    render(<StatsCards {...stats} />)

    for (const label of [
      'Auto-Answered', 'Deflection Rate', 'In Progress', 'Resolved',
      'Needs Review', 'AI Drafts Pending', 'SLA Breaches',
    ]) {
      const metric = screen.getByText(label)
      expect(metric).toBeVisible()
      expect(metric.closest('a, button, [role="link"], [role="button"], [tabindex]')).toBeNull()
    }
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)

    await user.tab()
    expect(screen.getByRole('link', { name: /^Open\s+12$/ })).toHaveFocus()
    await user.tab()
    expect(document.body).toHaveFocus()
  })

  it('allows keyboard focus and Enter activation of the Open link', async () => {
    const user = userEvent.setup()
    render(<StatsCards {...stats} />)
    const link = screen.getByRole('link', { name: /^Open\s+12$/ })
    // Keep the real Link and its browser semantics; intercept only navigation
    // because this component test has no running application router.
    const activate = vi.fn((event: Event) => event.preventDefault())
    link.addEventListener('click', activate)

    await user.tab()
    expect(link).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0][0].target).toBe(link)
    expect(link).toHaveAttribute('href', '/tickets?status=open')
  })
})
