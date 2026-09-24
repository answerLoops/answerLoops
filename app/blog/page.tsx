import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { MarketingPage, PageHero } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { NewsletterForm } from '@/components/marketing/newsletter-form'
import { getBlogPosts, formatPostDate } from '@/lib/blog/posts'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'answerLoops blog',
  description:
    'Notes on community support, integrations, and building answerLoops.',
  path: '/blog',
})

export default function BlogIndexPage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  const posts = getBlogPosts()

  return (
    <MarketingPage>
      <PageSchema
        name="answerLoops blog"
        description="Notes on community support, integrations, and building answerLoops."
        path="/blog"
        type="CollectionPage"
      />
      <PageHero eyebrow="Blog" title="Notes on community support">
        <p>
          Thought leadership, integration guides, and comparisons from the
          team building answerLoops.
        </p>
      </PageHero>
      <section className="marketing-section marketing-soft">
        <div className="marketing-container marketing-post-list">
          {posts.map((post) => (
            <article className="marketing-post-card" key={post.url}>
              <Link
                href={post.url}
                className="marketing-post-card-cover"
                tabIndex={-1}
                aria-hidden="true"
              >
                <Image
                  src={post.data.coverImage ?? `${post.url}/opengraph-image`}
                  alt=""
                  width={1200}
                  height={630}
                  unoptimized
                />
              </Link>
              <div className="marketing-post-card-body">
                <p className="marketing-meta">
                  <span className="marketing-post-category">{post.data.category}</span>{' '}
                  · <time dateTime={post.data.datePublished}>
                    {formatPostDate(post.data.datePublished)}
                  </time>{' '}
                  · {post.data.author}
                </p>
                <h2>
                  <Link className="hover:text-blue-700" href={post.url}>
                    {post.data.title}
                  </Link>
                </h2>
                <p>{post.data.description}</p>
                <Link className="marketing-text-link" href={post.url}>
                  Read the article
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container marketing-newsletter">
          <div>
            <h2>Get new posts by email</h2>
            <p>
              Integration guides and notes on building answerLoops, sent
              when there&apos;s something worth reading. No spam, unsubscribe
              anytime.
            </p>
          </div>
          <NewsletterForm />
        </div>
      </section>
    </MarketingPage>
  )
}
