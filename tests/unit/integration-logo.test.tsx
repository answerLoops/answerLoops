// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntegrationLogo } from '@/components/docs/integration-logo'
import { LOGO_GLYPHS } from '@/components/docs/integration-logo-data'

const KNOWN: Array<[string, string]> = [
  ['discourse', 'Discourse'],
  ['discord', 'Discord'],
  ['slack', 'Slack'],
  ['circle', 'Circle'],
  ['google-chat', 'Google Chat'],
  ['telegram', 'Telegram'],
  ['email', 'Email'],
  ['github', 'GitHub'],
  ['notion', 'Notion'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Google Gemini'],
  ['groq', 'Groq'],
  ['mistral', 'Mistral'],
  ['ollama', 'Ollama'],
  ['mcp', 'MCP'],
  ['agent-skills', 'Agent skills'],
  ['stripe', 'Stripe'],
  ['channels', 'Your channels'],
  ['agent-api', 'Agent API'],
]

describe('IntegrationLogo', () => {
  it.each(KNOWN)('renders %s as an image labelled "%s logo"', (key, label) => {
    render(<IntegrationLogo name={key} />)
    expect(screen.getByRole('img', { name: `${label} logo` })).toBeInTheDocument()
  })

  it('draws a single brand-colored glyph path for a brand with a mark', () => {
    render(<IntegrationLogo name="discourse" />)
    const svg = screen.getByRole('img').querySelector('svg')!
    const paths = svg.querySelectorAll('path')
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('d')).toBe(LOGO_GLYPHS.discourse.d)
    expect(svg.getAttribute('fill')).toBe(LOGO_GLYPHS.discourse.color)
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
  })

  it('draws Slack with several colored paths', () => {
    render(<IntegrationLogo name="slack" />)
    const paths = screen.getByRole('img').querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThan(1)
    const fills = new Set(Array.from(paths).map((p) => p.getAttribute('fill')))
    expect(fills.size).toBeGreaterThan(1)
  })

  it('falls back to a monogram for groq, which has no mark yet', () => {
    render(<IntegrationLogo name="groq" />)
    const logo = screen.getByRole('img')
    expect(logo.querySelector('svg')).toBeNull()
    expect(logo).toHaveTextContent(/^G$/)
  })

  it('draws the official OpenAI mark instead of the letter O', () => {
    render(<IntegrationLogo name="openai" />)
    const logo = screen.getByRole('img', { name: 'OpenAI logo' })
    const svg = logo.querySelector('svg')!
    const d = svg.querySelector('path')?.getAttribute('d')
    expect(d).toBe(LOGO_GLYPHS.openai.d)
    // Literals on purpose: comparing only to the data file would still pass
    // a bad crop or a swapped path.
    expect(d?.startsWith('M508.749 317.399')).toBe(true)
    expect(svg.getAttribute('viewBox')).toBe('174 174 368 368')
    expect(logo).not.toHaveTextContent(/\S/)
  })

  it('applies each glyph its own viewBox and defaults the rest to 24 x 24', () => {
    for (const [key, glyph] of Object.entries(LOGO_GLYPHS)) {
      const { unmount } = render(<IntegrationLogo name={key} />)
      const svg = screen.getByRole('img').querySelector('svg')
      expect(svg, key).not.toBeNull()
      expect(svg!.getAttribute('viewBox'), key).toBe(glyph.viewBox ?? '0 0 24 24')
      unmount()
    }
  })

  it('uses the first letter of an unknown name and keeps the name in the label', () => {
    render(<IntegrationLogo name="Zendesk" />)
    const logo = screen.getByRole('img', { name: 'Zendesk logo' })
    expect(logo).toHaveTextContent(/^Z$/)
    expect(logo.querySelector('svg')).toBeNull()
  })

  it.each([
    ['email', 'Email'],
    ['channels', 'Your channels'],
    ['agent-api', 'Agent API'],
  ])('renders a generic pictogram for %s with no glyph path', (key, label) => {
    render(<IntegrationLogo name={key} />)
    const logo = screen.getByRole('img', { name: `${label} logo` })
    const svg = logo.querySelector('svg')!
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(Object.values(LOGO_GLYPHS).map((g) => g.d)).not.toContain(
      svg.querySelector('path')?.getAttribute('d'),
    )
    expect(logo).not.toHaveTextContent(/\S/)
  })

  it('pictograms differ from each other', () => {
    const html = ['email', 'channels', 'agent-api'].map((k) => {
      const { container, unmount } = render(<IntegrationLogo name={k} />)
      const out = container.querySelector('svg')!.innerHTML
      unmount()
      return out
    })
    expect(new Set(html).size).toBe(3)
  })

  it.each(['Google Chat', 'google-chat', 'googlechat', '  GOOGLE CHAT  ', 'GoogleChat'])(
    'resolves "%s" to the Google Chat logo',
    (variant) => {
      render(<IntegrationLogo name={variant} />)
      const logo = screen.getByRole('img', { name: 'Google Chat logo' })
      expect(logo.querySelector('path')?.getAttribute('d')).toBe(LOGO_GLYPHS['google-chat'].d)
    },
  )

  it('sets width and height from the size prop, defaulting to 40', () => {
    const { rerender } = render(<IntegrationLogo name="notion" />)
    expect(screen.getByRole('img')).toHaveStyle({ width: '40px', height: '40px' })
    rerender(<IntegrationLogo name="notion" size={64} />)
    expect(screen.getByRole('img')).toHaveStyle({ width: '64px', height: '64px' })
    expect(screen.getByRole('img').querySelector('svg')).toHaveAttribute('width', '37')
  })

  it('appends a custom className', () => {
    render(<IntegrationLogo name="notion" className="rounded-lg" />)
    expect(screen.getByRole('img')).toHaveClass('rounded-lg')
  })
})
