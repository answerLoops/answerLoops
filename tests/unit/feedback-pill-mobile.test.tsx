// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

// On a phone the closed Feedback pill shrinks to its count and logo, and the
// dashboard leaves room at the bottom so the pill never covers the last
// control on a page.

vi.mock('@/lib/live-events', () => ({ subscribeLiveEvents: () => () => {} }))
vi.mock('@/lib/actions/product-feedback', () => ({
  submitProductFeedbackAction: vi.fn(),
  moderateProductFeedbackAction: vi.fn(),
  replyToProductFeedbackAction: vi.fn(),
  deleteProductFeedbackAction: vi.fn(),
  publishProductUpdateAction: vi.fn(),
  deleteProductUpdateAction: vi.fn(),
}))

import { FeedbackWidget } from '@/components/feedback/feedback-widget'

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ approvedCount: 4, feedback: [], updates: [] }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('closed Feedback pill on small screens', () => {
  it('hides the word and divider below the small breakpoint, keeping count and logo', async () => {
    render(<FeedbackWidget />)
    const pill = await screen.findByRole('button', { name: /Open product feedback/ })
    const word = screen.getByText('Feedback')
    expect(word.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(word.className).toMatch(/(^|\s)sm:inline(\s|$)/)
    const divider = pill.querySelector('[aria-hidden].w-px') as HTMLElement
    expect(divider.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(divider.className).toMatch(/sm:block/)
  })

  it('keeps the full spoken label whatever is shown', async () => {
    render(<FeedbackWidget />)
    expect(await screen.findByRole('button', { name: /Open product feedback, \d+ entr(y|ies)/ })).toBeTruthy()
  })
})

describe('dashboard layout', () => {
  const layout = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/layout.tsx'), 'utf8')

  it('ends the content with a spacer the pill can sit over, only when the widget is on', () => {
    expect(layout).toContain('{isFeedbackWidgetEnabled() && <div aria-hidden className="h-16" />}')
    expect(layout).toContain('{isFeedbackWidgetEnabled() && <FeedbackWidget />}')
  })
})
