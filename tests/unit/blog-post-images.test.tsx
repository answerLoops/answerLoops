import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import BlogPostPage from '@/app/blog/[slug]/page'

const { getBlogPost } = vi.hoisted(() => ({ getBlogPost: vi.fn() }))

vi.mock('@/lib/blog/posts', () => ({
  getBlogPost,
  getRelatedPosts: () => [],
  getBlogPosts: () => [],
  formatPostDate: (date: string) => date,
}))
vi.mock('@/lib/site', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/site')>()), marketingSiteEnabled: () => true }))
vi.mock('@/components/marketing/newsletter-form', () => ({ NewsletterForm: () => null }))

// What the MDX compiler hands an image: the imported static asset, not a path.
const staticImage = { src: '/_next/static/media/chat-workflows.abc123.png', width: 1537, height: 784 }

function postWithBodyImage() {
  return {
    data: {
      title: 'A post',
      subtitle: 'Sub',
      overview: 'Overview',
      description: 'Description',
      author: 'Author',
      datePublished: '2026-10-20',
      category: 'Guides',
      body: ({ components }: { components: Record<string, React.ComponentType<Record<string, unknown>>> }) => {
        const Img = components.img
        return <Img src={staticImage} alt="Chat workflows" />
      },
    },
    slugs: ['a-post'],
  }
}

describe('blog post images', () => {
  it('renders imported markdown images through the image optimizer instead of stringifying them', async () => {
    getBlogPost.mockReturnValue(postWithBodyImage())
    const page = await BlogPostPage({ params: Promise.resolve({ slug: 'a-post' }) })
    const markup = renderToStaticMarkup(page)

    expect(markup).not.toContain('[object Object]')
    expect(markup).toContain('alt="Chat workflows"')
    expect(markup).toContain('width="1537"')
    expect(markup).toContain('height="784"')
    expect(markup).toContain('chat-workflows.abc123.png')
  })
})
