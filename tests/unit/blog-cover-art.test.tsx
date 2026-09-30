import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BlogPostOgImage, { contentType, size } from '@/app/blog/[slug]/opengraph-image'

const { getPage, captures } = vi.hoisted(() => ({
  getPage: vi.fn(),
  captures: [] as { element: ReactElement; options: { width: number; height: number } }[],
}))

// Keep getBlogPost real so its publication rules are exercised by the route.
vi.mock('@/lib/blog/source', () => ({ blogSource: { getPage } }))
vi.mock('next/og', () => ({
  ImageResponse: vi.fn(function (element: ReactElement, options: { width: number; height: number }) {
    captures.push({ element, options })
  }),
}))

function publishedPost(title = 'A grounded answer', category = 'Product') {
  return { data: { title, category, draft: false } }
}

async function renderCover(slug: string) {
  await BlogPostOgImage({ params: Promise.resolve({ slug }) })
  const captured = captures.at(-1)!
  return { ...captured, markup: renderToStaticMarkup(captured.element) }
}

beforeEach(() => {
  captures.length = 0
  getPage.mockReset()
})

describe('blog cover image route', () => {
  it('selects the complete draft-and-review artwork for the published first cover', async () => {
    getPage.mockReturnValue(publishedPost())
    const { markup, options } = await renderCover('dual-agent-review')

    expect(getPage).toHaveBeenCalledWith(['dual-agent-review'])
    expect(markup).toContain('Good answers deserve')
    expect(markup).toContain('a second look.')
    expect(markup).toContain('Draft')
    expect(markup).toContain('Review')
    expect(markup).toContain('From your knowledge')
    expect(markup).toContain('Checked against sources')
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(markup).toContain('data:image/png;base64,')
    expect(options).toEqual({ width: 1200, height: 630 })
    expect(size).toEqual(options)
    expect(contentType).toBe('image/png')
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished article', draft: true } }],
  ])('keeps the generic cover when the first post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('dual-agent-review')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('Checked against sources')
    expect(markup).not.toContain('Unpublished article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('retains the title and category fallback for posts without bespoke artwork', async () => {
    getPage.mockReturnValue(publishedPost('Support across channels', 'Guides'))
    const { markup } = await renderCover('support-across-channels')

    expect(markup).toContain('Support across channels')
    expect(markup).toContain('Guides')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('<svg')
  })

  it.each([
    ['discord-community-support', '#5865f2'],
    ['slack-no-admin-approval', '#36c5f0'],
    ['discourse-forum-support', '#e4572e'],
    ['circle-community-support', '#7c3aed'],
    ['google-chat-internal-support', '#34a853'],
    ['telegram-community-support', '#229ed9'],
    ['email-support-automation', '#64748b'],
    ['github-open-source-support', '#24292f'],
    ['notion-knowledge-base-sync', '#000000'],
  ])('preserves the integration mark on %s', async (slug, brandColor) => {
    getPage.mockReturnValue(publishedPost('Integration guide', 'Integrations'))
    const { markup } = await renderCover(slug)

    expect(markup).toContain('Integration guide')
    expect(markup).toContain('Integrations')
    expect(markup).toContain('<svg')
    expect(markup).toContain('<path')
    expect(markup).toContain(brandColor)
    expect(markup).not.toContain('Good answers deserve')
  })

  it('renders the artwork through the real image engine as a 1200 × 630 PNG', async () => {
    getPage.mockReturnValue(publishedPost())
    const { element, options } = await renderCover('dual-agent-review')
    const { ImageResponse } = await vi.importActual<typeof import('next/og')>('next/og')
    const response = new ImageResponse(element, options)
    const png = Buffer.from(await response.arrayBuffer())

    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.toString('ascii', 12, 16)).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  }, 15000)
})
