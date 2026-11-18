// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TicketContent } from '@/components/tickets/ticket-content'

afterEach(cleanup)

describe('TicketContent', () => {
  it('renders GitHub Markdown formatting', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content={'## Release notes\n\n**Important update**\n\n- First item\n- Second item\n\n`npm test`'}
      />
    )

    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument()
    expect(screen.getByText('Important update').tagName).toBe('STRONG')
    expect(screen.getByText('First item')).toBeInTheDocument()
    expect(screen.getByText('Second item')).toBeInTheDocument()
    expect(screen.getByText('npm test').tagName).toBe('CODE')
  })

  it('does not render raw HTML as executable elements', () => {
    const { container } = render(
      <TicketContent
        sourcePlatform="github"
        content={'<script>alert("unsafe")</script>\n<img src=x onerror=alert(1) />'}
      />
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>')
  })

  it('renders safe external links in a new tab with safe rel attributes', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content="[Open docs](https://example.com/docs)"
      />
    )

    expect(screen.getByRole('link', { name: 'Open docs' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByRole('link', { name: 'Open docs' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Open docs' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render unsafe link protocols as clickable links', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content="[Unsafe link](javascript:alert%281%29)"
      />
    )

    expect(screen.queryByRole('link', { name: 'Unsafe link' })).not.toBeInTheDocument()
    expect(screen.getByText('Unsafe link')).toBeInTheDocument()
  })

  it('renders safe images responsively', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content="![Architecture diagram](https://example.com/architecture.png)"
      />
    )

    const image = screen.getByRole('img', { name: 'Architecture diagram' })
    expect(image).toHaveAttribute('src', 'https://example.com/architecture.png')
    expect(image).toHaveClass('max-w-full', 'h-auto')
  })

  it('preserves attachment links in GitHub messages', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content={'See the screenshot.\n[Attachment: shot.png] — https://files.example/shot.png'}
      />
    )

    expect(screen.getByText('See the screenshot.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /shot\.png/ })).toHaveAttribute(
      'href',
      'https://files.example/shot.png'
    )
  })

  it('keeps non-GitHub messages as plain text', () => {
    render(
      <TicketContent
        sourcePlatform="slack"
        content="**This should remain literal Markdown**"
      />
    )

    expect(screen.getByText('**This should remain literal Markdown**')).toBeInTheDocument()
    expect(screen.queryByText('This should remain literal Markdown')).not.toBeInTheDocument()
  })
})