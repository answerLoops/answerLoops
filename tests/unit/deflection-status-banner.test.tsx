// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeflectionStatusBanner } from '@/components/deflection-status-banner'

// Covers DeflectionStatusBanner: it renders nothing when every connected
// integration is on auto-send (offPlatforms empty), otherwise it warns that
// N integrations are set to manual review, pluralizing "integration" vs
// "integrations" correctly and naming the affected platforms, with a link
// back to /integrations so the user can flip them to auto-send.

describe('DeflectionStatusBanner', () => {
  it('renders nothing when offPlatforms is empty', () => {
    const { container } = render(<DeflectionStatusBanner offPlatforms={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('uses singular copy for exactly one off-platform integration', () => {
    render(<DeflectionStatusBanner offPlatforms={['Discord']} />)
    expect(screen.getByText(/1 connected integration set to manual review/)).toBeInTheDocument()
    expect(screen.queryByText(/1 connected integrations/)).not.toBeInTheDocument()
  })

  it('uses plural copy and joins platform names for multiple off-platform integrations', () => {
    render(<DeflectionStatusBanner offPlatforms={['Google Chat', 'Discord']} />)
    expect(screen.getByText(/2 connected integrations set to manual review/)).toBeInTheDocument()

    const names = screen.getByText('Google Chat, Discord')
    expect(names).toBeInTheDocument()
    expect(names.tagName).toBe('SPAN')
    expect(names.className).toContain('font-semibold')
  })

  it('renders a Review Integrations link pointing to /integrations', () => {
    render(<DeflectionStatusBanner offPlatforms={['Discord']} />)
    const link = screen.getByRole('link', { name: 'Review Integrations' })
    expect(link).toHaveAttribute('href', '/integrations')
  })
})
