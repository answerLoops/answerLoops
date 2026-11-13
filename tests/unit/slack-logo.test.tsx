import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { SLACK_LOGO } from '@/lib/marketing/slack-logo'

// The Slack mark on the homepage rail drifted into scattered fragments because
// each surface carried its own hand-drawn copy of the path. One shared module
// now feeds the homepage rail, sign-in page, and animated chat.

const BRAND_COLORS = ['#e01e5a', '#36c5f0', '#2eb67d', '#ecb22e']

describe('SLACK_LOGO', () => {
  it('has the four Slack brand colors, one shape each, on the 127 x 127 canvas', () => {
    expect(SLACK_LOGO.viewBox).toBe('0 0 127 127')
    expect(SLACK_LOGO.paths.map((p) => p.fill).sort()).toEqual([...BRAND_COLORS].sort())
    expect(new Set(SLACK_LOGO.paths.map((p) => p.d)).size).toBe(4)
  })

  it('every shape is a closed path that starts inside the canvas', () => {
    for (const { d } of SLACK_LOGO.paths) {
      expect(d).toMatch(/^M\d/)
      expect(d.toLowerCase().endsWith('z')).toBe(true)
    }
  })
})

describe('Slack logo on the site', () => {
  it('the channel icon draws the shared mark, not a private copy', () => {
    const html = renderToStaticMarkup(<IntegrationIcon name="Slack" color="#36c5f0" />)
    expect(html).toContain(`viewBox="${SLACK_LOGO.viewBox}"`)
    for (const { d, fill } of SLACK_LOGO.paths) {
      expect(html).toContain(`d="${d}"`)
      expect(html).toContain(`fill="${fill}"`)
    }
  })

  it('no longer contains the earlier hand-drawn fragments', () => {
    const html = renderToStaticMarkup(<IntegrationIcon name="Slack" color="#36c5f0" />)
    expect(html).not.toContain('M9.1 2.5a2.1')
  })
})
