import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingPage, PageHero } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { BLOG_POSTS, formatPostDate } from './posts'
export const metadata: Metadata = {
  title: 'AnswerLoops blog',
  description:
    'Notes from the founders on community support and building AnswerLoops.',
  alternates: { canonical: '/blog' },
}
export default function BlogIndexPage() {
  return (
    <MarketingPage>
      <PageSchema
        name="AnswerLoops blog"
        description="Notes on community support and building AnswerLoops."
        path="/blog"
        type="CollectionPage"
      />
      <PageHero eyebrow="Blog" title="Notes on community support">
        <p>
          What we are learning while building AnswerLoops and using it in our
          communities.
        </p>
      </PageHero>
      <section className="marketing-section">
        <div className="marketing-container marketing-reading">
          {BLOG_POSTS.map((post) => (
            <article className="border-b border-slate-200 pb-8" key={post.slug}>
              <p className="marketing-meta">
                <time dateTime={post.datePublished}>
                  {formatPostDate(post.datePublished)}
                </time>{' '}
                · {post.author}
              </p>
              <h2>
                <Link
                  className="hover:text-blue-700"
                  href={`/blog/${post.slug}`}
                >
                  {post.title}
                </Link>
              </h2>
              <p>{post.description}</p>
              <Link className="marketing-text-link" href={`/blog/${post.slug}`}>
                Read the article →
              </Link>
            </article>
          ))}
        </div>
      </section>
    </MarketingPage>
  )
}
