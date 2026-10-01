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
    'Architecture notes, integration guides, and benchmarks from the team building answerLoops.',
  path: '/blog',
})

export default function BlogIndexPage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  const posts = getBlogPosts()
  const [featuredPost, ...restPosts] = posts

  return (
    <MarketingPage>
      <PageSchema
        name="answerLoops blog"
        description="Architecture notes, integration guides, and benchmarks from the team building answerLoops."
        path="/blog"
        type="CollectionPage"
      />
      <PageHero title="Engineering the support layer">
        <p>
          Architecture notes, integration guides, and benchmarks from the
          team building answerLoops.
        </p>
      </PageHero>
      <section className="marketing-section marketing-post-top">
        {featuredPost && (
          <div className="marketing-container">
            <article className="marketing-post-featured">
              <div className="marketing-post-featured-body">
                <p className="marketing-meta">
                  <span className="block">{featuredPost.data.author}</span>
                  <time className="block" dateTime={featuredPost.data.datePublished}>
                    {formatPostDate(featuredPost.data.datePublished)}
                  </time>
                </p>
                <h2>
                  <Link className="hover:text-blue-700" href={featuredPost.url}>
                    {featuredPost.data.title}
                  </Link>
                </h2>
                <p>{featuredPost.data.description}</p>
                <Link className="marketing-text-link" href={featuredPost.url}>
                  Read the article
                </Link>
              </div>
              <Link
                href={featuredPost.url}
                className="marketing-post-featured-cover"
                tabIndex={-1}
                aria-hidden="true"
              >
                <Image
                  src={featuredPost.data.coverImage ?? `${featuredPost.url}/opengraph-image`}
                  alt=""
                  width={1200}
                  height={630}
                  unoptimized
                  priority
                />
              </Link>
            </article>
          </div>
        )}
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
      <section className="marketing-section marketing-soft">
        <div className="marketing-container marketing-post-list">
          {restPosts.map((post) => (
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
                  <span className="block">{post.data.author}</span>
                  <time className="block" dateTime={post.data.datePublished}>
                    {formatPostDate(post.data.datePublished)}
                  </time>
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
    </MarketingPage>
  )
}
