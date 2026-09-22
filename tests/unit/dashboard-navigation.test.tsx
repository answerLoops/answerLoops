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
    expect(screen.getByText('All systems operational')).toBeInTheDocument()
  })

  it('keeps the parent ticket destination active on detail routes', () => {
    navigation.pathname = '/tickets/42'
    render(<SidebarNav />)

    expect(screen.getByRole('link', { name: /Tickets/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current')
  })
})

describe('dashboard stats', () => {
  it('calculates the deflection rate and renders the complete operating snapshot', () => {
    render(
      <StatsCards
        total={20}
        open={4}
        inProgress={3}
        resolved={13}
        slaBreaches={1}
        pendingDrafts={2}
        needsReview={5}
        autoDeflected={15}
      />,
    )

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Auto-Answered')).toBeInTheDocument()
    expect(screen.getByText('SLA Breaches')).toBeInTheDocument()
    expect(screen.getAllByText(/./).length).toBeGreaterThan(8)
  })

  it('avoids an invalid percentage when no tickets exist', () => {
    render(
      <StatsCards
        total={0}
        open={0}
        inProgress={0}
        resolved={0}
        slaBreaches={0}
        pendingDrafts={0}
        needsReview={0}
        autoDeflected={0}
      />,
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
