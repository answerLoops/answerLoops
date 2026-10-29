// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DocsSidebarFooter } from '@/components/docs/docs-sidebar-footer'

afterEach(cleanup)

describe('DocsSidebarFooter', () => {
  it('shows a Changelog link to the address it is given', () => {
    render(<DocsSidebarFooter changelogUrl="https://answerloops.com/changelog" />)
    const link = screen.getByRole('link', { name: 'Changelog' })
    expect(link).toHaveAttribute('href', 'https://answerloops.com/changelog')
  })

  it('opens in the same tab, like the other docs entries, and needs no opener protection', () => {
    render(<DocsSidebarFooter changelogUrl="https://answerloops.com/changelog" />)
    const link = screen.getByRole('link', { name: 'Changelog' })
    expect(link).not.toHaveAttribute('target')
  })

  it('renders nothing at all when there is no address, so a self-hosted install gets no dead link or empty gap', () => {
    const { container } = render(<DocsSidebarFooter changelogUrl={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Changelog')).not.toBeInTheDocument()
  })

  it('hides its icon from screen readers, so the link is announced as just "Changelog"', () => {
    const { container } = render(<DocsSidebarFooter changelogUrl="https://answerloops.com/changelog" />)
    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link')).toHaveAccessibleName('Changelog')
  })

  it('is reachable by keyboard: a plain anchor with an address, in the tab order', () => {
    render(<DocsSidebarFooter changelogUrl="https://answerloops.com/changelog" />)
    const link = screen.getByRole('link', { name: 'Changelog' })
    expect(link.tagName).toBe('A')
    expect(link).not.toHaveAttribute('tabindex', '-1')
  })

  it('wraps long text rather than overflowing a narrow sidebar', () => {
    render(<DocsSidebarFooter changelogUrl="https://answerloops.com/changelog" />)
    // The icon never shrinks and the row is a flex container, so the label wraps beside it.
    const link = screen.getByRole('link', { name: 'Changelog' })
    expect(link.className).toContain('flex')
    expect(link.className).toContain('[&_svg]:shrink-0')
  })
})
