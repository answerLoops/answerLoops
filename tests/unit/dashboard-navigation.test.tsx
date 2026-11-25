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

  it('lists seven destinations, with Leads, FAQ and Simulation moved under their sections', () => {
    render(<SidebarNav />)

    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim())
    expect(labels.slice(0, 7)).toEqual(['Dashboard', 'Analytics', 'Tickets', 'Knowledge Base', 'Billing', 'Integrations', 'Settings'])
    for (const gone of ['Leads', 'FAQ', 'Simulation', 'Knowledge Gaps']) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${gone}`) })).toBeNull()
    }
  })

  it.each([
    ['/leads', 'Tickets'],
    ['/tickets', 'Tickets'],
    ['/faq', 'Knowledge Base'],
    ['/simulation', 'Knowledge Base'],
    ['/kb', 'Knowledge Base'],
  ])('keeps %s under the %s entry', (pathname, entry) => {
    navigation.pathname = pathname
    render(<SidebarNav />)

    expect(screen.getByRole('link', { name: new RegExp(entry) })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1)
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

    // Match the text, not the link role: without an address the entry would be
    // an anchor with no href, which is not exposed as a link, so a role query
    // would pass even if the entry rendered. The label also uses a typographic
    // apostrophe, so match any character there.
    expect(screen.queryByText(/What.s new/)).not.toBeInTheDocument()
  })
})

describe('dashboard stats', () => {
  it('renders the measured deflection rate and the ticket counts', () => {
    render(
      <StatsCards
        open={4}
        inProgress={3}
        resolved={13}
        autoDeflected={15}
        deflectionRate={75}
      />,
    )

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Auto-Answered')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    expect(screen.getByText('3 in progress')).toBeInTheDocument()
  })

  it('renders a zero rate when nothing has been answered', () => {
    render(
      <StatsCards
        open={0}
        inProgress={0}
        resolved={0}
        autoDeflected={0}
        deflectionRate={0}
      />,
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
