import { ImageResponse } from 'next/og'
import { getBlogPost } from '@/lib/blog/posts'

// Auto-generated cover art fallback: a post only needs a `coverImage` in its
// frontmatter if it wants a specific photo/illustration. Without one, this
// route renders a title+category card so publishing a new SEO post never
// blocks on producing an image. Visual language matches
// scripts/generate-social-card.mjs's site-wide share card.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function BlogPostOgImage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getBlogPost(slug)
  const title = post?.data.title ?? 'answerLoops'
  const category = post?.data.category ?? 'Blog'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#f5f7f7',
          color: '#082e50',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 32, fontWeight: 700 }}>
          answer<span style={{ color: '#168fa3' }}>Loops</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 24, color: '#168fa3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2 }}>
            {category}
          </div>
          <div style={{ display: 'flex', fontSize: 58, fontWeight: 700, lineHeight: 1.15, maxWidth: 1000 }}>
            {title}
          </div>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid #d8dfe2', paddingTop: 20, fontSize: 24, color: '#205c70' }}>
          answerloops.com/blog
        </div>
      </div>
    ),
    size
  )
}
