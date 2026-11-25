// @vitest-environment happy-dom
import { createElement } from 'react'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FeatureShowcase } from '@/components/marketing/feature-showcase'
import { getShot } from '@/components/docs/shots'

// next/image needs Next's loader config; render a plain <img> with the props
// the component passes so src/alt can be asserted directly.
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }),
}))

// The real registry is used on purpose: a renamed or deleted shot id must fail here.
const ROWS = [
  { shot: 'ticket-detail', heading: 'See which questions still need an answer' },
  { shot: 'dashboard', heading: 'See what’s urgent before it’s late' },
  { shot: 'knowledge-gaps', heading: 'Find the gaps in your docs' },
  { shot: 'analytics', heading: 'See where your support is improving' },
] as const

function renderRows() {
  const { container } = render(<FeatureShowcase />)
  const rows = Array.from(container.querySelectorAll<HTMLElement>('article'))
  return { container, rows }
}

describe('FeatureShowcase', () => {
  it('renders one row per feature, in order, each with its heading', () => {
    const { rows } = renderRows()
    expect(rows).toHaveLength(ROWS.length)
    rows.forEach((row, i) => {
      expect(within(row).getByRole('heading', { level: 3 })).toHaveTextContent(ROWS[i].heading)
    })
  })

  it('states plan availability in the Knowledge gaps description', () => {
    const { rows } = renderRows()
    const availability = 'Available on Pro and Enterprise.'
    expect(within(rows[2]).getByText(availability, { exact: false })).toBeVisible()
    expect(screen.getAllByText(availability, { exact: false })).toHaveLength(1)
  })

  it('flips every second row so the image alternates sides', () => {
    const { rows } = renderRows()
    expect(rows[0]).not.toHaveAttribute('data-flip')
    expect(rows[1]).toHaveAttribute('data-flip')
    expect(rows[2]).not.toHaveAttribute('data-flip')
    expect(rows[3]).toHaveAttribute('data-flip')
  })

  it('resolves every row image from the shot registry', () => {
    for (const { shot } of ROWS) {
      expect(() => getShot(shot)).not.toThrow()
    }
    const { rows } = renderRows()
    rows.forEach((row, i) => {
      const expected = getShot(ROWS[i].shot)
      const img = within(row).getByRole('img')
      expect(img).toHaveAttribute('alt', expected.alt)
      expect(img).toHaveAttribute('src', expected.src)
      expect(expected.alt.trim()).not.toBe('')
    })
  })

  it('links each row to a docs page that exists on disk', () => {
    const { rows } = renderRows()
    const docsRoot = path.resolve(__dirname, '../../content/docs')
    rows.forEach((row) => {
      const link = within(row).getByRole('link')
      const href = link.getAttribute('href')!
      expect(href).toMatch(/^\/docs\/[a-z0-9/-]+$/)
      const slug = href.replace(/^\/docs\//, '')
      const page = path.join(docsRoot, `${slug}.mdx`)
      const index = path.join(docsRoot, slug, 'index.mdx')
      expect(existsSync(page) || existsSync(index), `${href} has no docs page`).toBe(true)
      expect(link.textContent?.trim()).not.toBe('')
    })
  })
})
