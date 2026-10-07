// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { UpdatesTab } from '@/components/feedback/updates-tab'
import type { BoardUpdate } from '@/lib/product-feedback/validation'

afterEach(cleanup)

const update = (id: number, o: Partial<BoardUpdate> = {}): BoardUpdate => ({
  id,
  title: `Update ${id}`,
  body: `Body ${id}`,
  publishedAt: '2026-10-06T12:00:00.000Z',
  ...o,
})

describe('UpdatesTab', () => {
  it('shows the empty state and no list when there are no updates', () => {
    render(<UpdatesTab updates={[]} />)
    expect(screen.getByText(/no updates yet/i)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('renders title, formatted date and body for an update, and no empty state', () => {
    render(<UpdatesTab updates={[update(1, { title: 'Faster KB sync', body: 'Syncs run in the background.' })]} />)
    expect(screen.getByText('Faster KB sync')).toBeTruthy()
    expect(screen.getByText(/^Oct 6, 2026/)).toBeTruthy()
    expect(screen.getByText('Syncs run in the background.')).toBeTruthy()
    expect(screen.queryByText(/no updates yet/i)).toBeNull()
  })

  it('renders every update in the order given (does not re-sort)', () => {
    render(<UpdatesTab updates={[update(2), update(9), update(5)]} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Update 2'),
      expect.stringContaining('Update 9'),
      expect.stringContaining('Update 5'),
    ])
  })

  it('preserves line breaks in the body', () => {
    render(<UpdatesTab updates={[update(1, { body: 'a\nb' })]} />)
    const p = screen.getByText(/^a/)
    expect(p.textContent).toBe('a\nb')
    expect(p.className).toContain('whitespace-pre-wrap') // no stylesheet in happy-dom; assert the class carrying the rule
  })

  it('renders HTML in title and body as text, not markup', () => {
    const { container } = render(
      <UpdatesTab updates={[update(1, { title: '<h1>big</h1>', body: '<img src=x onerror=alert(1)>' })]} />,
    )
    expect(screen.getByText('<h1>big</h1>')).toBeTruthy()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
    expect(container.querySelector('h1, img')).toBeNull()
  })

  it('omits the date text rather than showing "Invalid Date" for a bad timestamp', () => {
    const { container } = render(<UpdatesTab updates={[update(1, { publishedAt: 'garbage' })]} />)
    expect(container.textContent).not.toMatch(/invalid date|nan/i)
  })
})
