// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarNav } from '@/components/dashboard/sidebar-nav'
import { StatsCards } from '@/components/dashboard/stats-cards'

const navigation = vi.hoisted(() => ({
  pathname: '/dashboard',
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))

describe('dashboard navigation', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard'
  })

  it('organizes every workspace destination into scannable groups', () => {
    render(<SidebarNav />)

    for (const group of ['Monitor', 'Support', 'Improve', 'Configure']) {
      expect(screen.getByText(group)).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('aria-current', 'page')
    // The sidebar must not claim a system status it does not actually check.
    expect(screen.queryByText('All systems operational')).not.toBeInTheDocument()
  })

  it('keeps the parent ticket destination active on detail routes', () => {
    navigation.pathname = '/tickets/42'
    render(<SidebarNav />)

    expect(screen.getByRole('link', { name: /Tickets/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current')
  })

  it('shows the changelog link, in a new tab, when one is passed down', () => {
    render(<SidebarNav changelogUrl="https://answerloops.com/changelog" />)

    const link = screen.getByRole('link', { name: /What.s new/ })
    expect(link).toHaveAttribute('href', 'https://answerloops.com/changelog')
    // Opens outside the app, so it must not hand the dashboard's origin away
    // to the tab it lands in.
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows no changelog link when none is passed down', () => {
    // A self-hosted install serves no /changelog, and the layout passes nothing
    // rather than a link that 404s.
    render(<SidebarNav />)

    expect(screen.queryByRole('link', { name: /What's new/ })).not.toBeInTheDocument()
  })
})

describe('dashboard stats', () => {
  it('renders the measured deflection rate and the the complete operating snapshot', () => {
    render(
      <StatsCards
        open={4}
        inProgress={3}
        resolved={13}
        slaBreaches={1}
        pendingDrafts={2}
        needsReview={5}
        autoDeflected={15}
        deflectionRate={75}
      />,
    )

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Auto-Answered')).toBeInTheDocument()
    expect(screen.getByText('SLA Breaches')).toBeInTheDocument()
    expect(screen.getAllByText(/./).length).toBeGreaterThan(8)
  })

  it('renders a zero rate when nothing has been answered', () => {
    render(
      <StatsCards
        open={0}
        inProgress={0}
        resolved={0}
        slaBreaches={0}
        pendingDrafts={0}
        needsReview={0}
        autoDeflected={0}
        deflectionRate={0}
      />,
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
