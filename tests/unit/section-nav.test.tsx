// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ pathname: '/tickets', planId: 'pro' as string | null }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }))
vi.mock('@/components/billing/use-plan-id', () => ({ usePlanId: () => h.planId }))
vi.mock('@/components/billing/locked-feature', () => ({ LockBadge: () => <span data-testid="lock" /> }))

import { SectionNav } from '@/components/dashboard/section-nav'

beforeEach(() => {
  h.pathname = '/tickets'
  h.planId = 'pro'
})

const links = () => screen.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])

describe('SectionNav', () => {
  it.each(['/tickets', '/leads'])('links Tickets and Leads together on %s', (pathname) => {
    h.pathname = pathname
    render(<SectionNav />)
    expect(screen.getByRole('navigation', { name: 'Support pages' })).toBeInTheDocument()
    expect(links()).toEqual([['Tickets', '/tickets'], ['Leads', '/leads']])
  })

  it.each(['/kb', '/faq', '/simulation'])('links Knowledge Base, FAQ and Simulation together on %s', (pathname) => {
    h.pathname = pathname
    render(<SectionNav />)
    expect(screen.getByRole('navigation', { name: 'Knowledge pages' })).toBeInTheDocument()
    expect(links()).toEqual([['Knowledge Base', '/kb'], ['FAQ', '/faq'], ['Simulation', '/simulation']])
  })

  it('marks the current page', () => {
    h.pathname = '/faq'
    render(<SectionNav />)
    expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Simulation' })).not.toHaveAttribute('aria-current')
  })

  it.each(['/dashboard', '/analytics', '/settings', '/integrations', '/billing', '/tickets/42', '/kb/anything'])(
    'is not shown on %s',
    (pathname) => {
      h.pathname = pathname
      const { container } = render(<SectionNav />)
      expect(container.firstChild).toBeNull()
    }
  )

  it('flags Simulation with a lock on a plan without it, and nothing else', () => {
    h.pathname = '/kb'
    h.planId = 'standard'
    render(<SectionNav />)
    expect(screen.getAllByTestId('lock')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Simulation' })).toContainElement(screen.getByTestId('lock'))
  })

  it('shows no lock on a plan that includes Simulation', () => {
    h.pathname = '/kb'
    h.planId = 'pro'
    render(<SectionNav />)
    expect(screen.queryByTestId('lock')).toBeNull()
  })

  it('shows no lock while the plan is still loading', () => {
    h.pathname = '/kb'
    h.planId = null
    render(<SectionNav />)
    expect(screen.queryByTestId('lock')).toBeNull()
  })
})
