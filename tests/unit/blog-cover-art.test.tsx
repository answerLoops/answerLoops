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


const COVERS = [
  ['dual-agent-review', 'One AI drafts.', 'One AI doubts.'],
  ['mcp-server-for-support', 'Agents can', 'reach in'],
  ['circle-community-support', 'Your members', 'ask once'],
  ['discord-community-support', 'Forum posts', 'become tickets'],
  ['discourse-forum-support', 'Same question,', 'answered'],
  ['email-support-automation', 'One inbox,', 'one thread'],
  ['github-open-source-support', 'Answer it', 'not twenty'],
  ['google-chat-internal-support', 'Pair a space', 'with one code'],
  ['notion-knowledge-base-sync', 'Share a page,', 'ship the answer'],
  ['slack-no-admin-approval', 'Skip the', 'admin queue'],
  ['telegram-community-support', 'A group chat', 'that never sleeps'],
  ['managing-every-community-platform-from-one-place', 'Every channel,', 'one inbox'],
  ['turn-support-answers-into-reusable-knowledge', 'Answer it', 'keep it'],
] as const

describe('blog cover image route', () => {
  it.each(COVERS)('draws the bespoke artwork for the published %s post', async (slug, lineOne, lineTwo) => {
    getPage.mockReturnValue(publishedPost())
    const { markup, options } = await renderCover(slug)

    expect(getPage).toHaveBeenCalledWith([slug])
    expect(markup).toContain(lineOne)
    expect(markup).toContain(lineTwo)
    expect(markup).toContain('data:image/png;base64,')
    expect(markup).not.toContain('answerloops.com/blog')
    expect(options).toMatchObject({ width: 1200, height: 630 })
    expect(size).toEqual({ width: 1200, height: 630 })
    expect(contentType).toBe('image/png')
  })

  it.each(COVERS)('keeps the generic cover when the %s post is absent or a draft', async (slug, lineOne) => {
    for (const page of [undefined, { data: { ...publishedPost().data, title: 'Unpublished article', draft: true } }]) {
      getPage.mockReturnValue(page)
      const { markup } = await renderCover(slug)

      expect(markup).toContain('Blog')
      expect(markup).toContain('answerloops.com/blog')
      expect(markup).not.toContain(lineOne)
      expect(markup).not.toContain('Unpublished article')
      expect(markup).not.toContain('data:image/png;base64,')
    }
  })

  it('gives every cover its own background so the blog index reads as a set', async () => {
    getPage.mockReturnValue(publishedPost())
    const gradients = new Set<string | undefined>()
    for (const [slug] of COVERS) {
      const { markup } = await renderCover(slug)
      gradients.add(markup.match(/background-image:([^;"]+)/)?.[1])
    }
    expect(gradients.size).toBe(COVERS.length)
  })

  it('passes the bold font to the image engine for every cover', async () => {
    getPage.mockReturnValue(publishedPost())
    for (const [slug] of COVERS) {
      const { options } = (await renderCover(slug)) as { options: { fonts?: { name: string; weight: number }[] } }
      expect(options.fonts?.[0]).toMatchObject({ name: 'Geist', weight: 700 })
    }
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

  it.each(['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support', 'email-support-automation', 'github-open-source-support', 'google-chat-internal-support', 'notion-knowledge-base-sync', 'slack-no-admin-approval', 'telegram-community-support', 'managing-every-community-platform-from-one-place', 'turn-support-answers-into-reusable-knowledge'])('renders %s through the real image engine as a 1200 × 630 PNG', async (slug) => {
    getPage.mockReturnValue(publishedPost())
    const { element, options } = await renderCover(slug)
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
