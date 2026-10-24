// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Screenshot } from '@/components/docs/screenshot'

vi.mock('fumadocs-ui/components/image-zoom', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  ImageZoom: ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) => (
    <img src={src} alt={alt} width={width} height={height} />
  ),
}))

vi.mock('@/components/docs/shots', () => ({
  getShot: (id: string) => {
    if (id !== 'demo') throw new Error(`Unknown screenshot "${id}"`)
    return { src: '/docs/shots/demo.webp', width: 1600, height: 900, alt: 'Generated alt text', pins: [] }
  },
}))

describe('Screenshot', () => {
  it('renders the shot with its size and generated alt text', () => {
    render(<Screenshot shot="demo" />)
    const img = screen.getByRole('img', { name: 'Generated alt text' })
    expect(img).toHaveAttribute('src', '/docs/shots/demo.webp')
    expect(img).toHaveAttribute('width', '1600')
    expect(img).toHaveAttribute('height', '900')
  })

  it('lets a page override the alt text', () => {
    render(<Screenshot shot="demo" alt="Just the stat cards" />)
    expect(screen.getByRole('img', { name: 'Just the stat cards' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Generated alt text' })).toBeNull()
  })

  it('shows a caption only when one is given', () => {
    const { rerender, container } = render(<Screenshot shot="demo" />)
    expect(container.querySelector('figcaption')).toBeNull()
    rerender(<Screenshot shot="demo" caption="The dashboard at a glance" />)
    expect(screen.getByText('The dashboard at a glance').tagName).toBe('FIGCAPTION')
  })

  it('fails loudly for an unknown screenshot id', () => {
    expect(() => render(<Screenshot shot="nope" />)).toThrow(/Unknown screenshot "nope"/)
  })
})
