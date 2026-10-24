// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Hotspots } from '@/components/docs/hotspots'

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

vi.mock('@/components/docs/shots', () => ({
  getShot: (id: string) => {
    if (id !== 'demo') throw new Error(`Unknown screenshot "${id}"`)
    return {
      src: '/docs/shots/demo.webp',
      width: 1600,
      height: 900,
      alt: 'A demo screen',
      pins: [
        { id: 'nav', label: 'Navigation', x: 0, y: 0, w: 20, h: 100 },
        { id: 'cards', label: 'Stat cards', x: 22, y: 20, w: 70, h: 30 },
        // Same corner as "cards": the badges must not stack on each other.
        { id: 'first-card', label: 'First card', x: 22, y: 20, w: 15, h: 15 },
      ],
    }
  },
}))

const spotlight = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('div[aria-hidden="true"].pointer-events-none')

describe('Hotspots', () => {
  it('shows the image with its alt text and one numbered pin and legend entry per region', () => {
    render(<Hotspots shot="demo" />)
    expect(screen.getByRole('img', { name: 'A demo screen' })).toHaveAttribute('src', '/docs/shots/demo.webp')
    expect(screen.getByRole('button', { name: '1. Navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2. Stat cards' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3. First card' })).toBeInTheDocument()
    expect(screen.getAllByText('Stat cards')).toHaveLength(1)
  })

  it('shows no spotlight until a region is hovered, then spotlights exactly that region', async () => {
    const user = userEvent.setup()
    const { container } = render(<Hotspots shot="demo" />)
    expect(spotlight(container)).toBeNull()

    await user.hover(screen.getByRole('button', { name: '2. Stat cards' }))
    const box = spotlight(container)!
    expect(box).toBeInTheDocument()
    expect(box.style.left).toBe('22%')
    expect(box.style.top).toBe('20%')
    expect(box.style.width).toBe('70%')
    expect(box.style.height).toBe('30%')

    await user.unhover(screen.getByRole('button', { name: '2. Stat cards' }))
    expect(spotlight(container)).toBeNull()
  })

  it('spotlights a region from keyboard focus, from the legend as well as the pin', async () => {
    const user = userEvent.setup()
    const { container } = render(<Hotspots shot="demo" />)
    await user.tab()
    const [firstPin] = screen.getAllByRole('button', { name: /Navigation/ })
    expect(firstPin).toHaveFocus()
    expect(spotlight(container)!.style.width).toBe('20%')

    await user.tab() // second pin
    await user.tab() // third pin
    await user.tab() // first legend entry
    expect(screen.getAllByRole('button', { name: /Navigation/ })[1]).toHaveFocus()
    expect(spotlight(container)!.style.width).toBe('20%')
  })

  it('marks the active region as pressed on both its pin and its legend entry', async () => {
    const user = userEvent.setup()
    render(<Hotspots shot="demo" />)
    await user.hover(screen.getByRole('button', { name: '3. First card' }))
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(2)
    for (const b of pressed) expect(b).toHaveTextContent(/First card|3/)
  })

  it('renders each note beside its region and omits notes that were not given', () => {
    render(<Hotspots shot="demo" notes={{ cards: 'Live counts for your tickets.' }} />)
    expect(screen.getByText('Live counts for your tickets.')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).toBeNull()
  })

  it('shows only the requested regions, in the requested order and numbering', () => {
    render(<Hotspots shot="demo" only={['cards', 'nav']} />)
    expect(screen.getByRole('button', { name: '1. Stat cards' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2. Navigation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /First card/ })).toBeNull()
  })

  it('moves a badge sideways when two regions share a corner', () => {
    render(<Hotspots shot="demo" />)
    const cards = screen.getByRole('button', { name: '2. Stat cards' })
    const first = screen.getByRole('button', { name: '3. First card' })
    expect(cards.style.left).toBe('22%')
    expect(parseFloat(first.style.left)).toBeGreaterThan(22 + 3)
    expect(first.style.top).toBe(cards.style.top)
  })

  it('keeps a badge inside the image when its region starts at the edge', () => {
    render(<Hotspots shot="demo" />)
    const nav = screen.getByRole('button', { name: '1. Navigation' })
    expect(parseFloat(nav.style.left)).toBeGreaterThan(0)
    expect(parseFloat(nav.style.top)).toBeGreaterThan(0)
  })

  it('fails loudly for an unknown screenshot id', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Hotspots shot="nope" />)).toThrow(/Unknown screenshot "nope"/)
    spy.mockRestore()
  })
})
