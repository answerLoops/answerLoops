// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ChatMarkdown } from '@/app/widget/[widgetToken]/chat-markdown'

/**
 * The assistant's reply text in the widget bubble. Light formatting must show
 * as formatting, and anything beyond that small set must stay inert, because
 * the model's output is rendered on a customer's page.
 */
function html(text: string) {
  return render(<ChatMarkdown text={text} />).container.innerHTML
}

describe('ChatMarkdown', () => {
  it('renders bold and inline code instead of showing the markers', () => {
    const out = html('Use **Add to Slack** and watch for `invalid_state`.')
    expect(out).toContain('<strong')
    expect(out).toContain('Add to Slack')
    expect(out).toContain('<code')
    expect(out).not.toContain('**')
    expect(out).not.toContain('`')
  })

  it('renders short lists', () => {
    const out = html('- one\n- two')
    expect(out).toContain('<ul')
    expect(out.match(/<li/g)).toHaveLength(2)
  })

  it('opens links in a new tab without leaking the opener', () => {
    const out = html('See [the docs](https://answerloops.com/docs).')
    expect(out).toContain('href="https://answerloops.com/docs"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('noopener')
  })

  it('drops links that are not http or https but keeps their text', () => {
    const out = html('[click](javascript:alert(1)) and [mail](mailto:a@b.co)')
    expect(out).not.toContain('<a')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('never renders images, headings, tables or raw HTML', () => {
    const { container } = render(
      <ChatMarkdown text={'![x](https://evil.test/p.png)\n\n# Big\n\n<script>alert(1)</script><img src=x onerror=alert(1)>'} />
    )
    // Real elements only: the raw HTML is shown as inert text, never parsed.
    expect(container.querySelector('img, h1, script, table, iframe')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
  })
})
