import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { MarketingPage, PageHero, TrialCta } from '@/components/marketing/layout'
import { NewsletterForm } from '@/components/marketing/newsletter-form'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORGANIZATION_ID, WEBSITE_ID } from '@/lib/site-identity'
import { getBlogPost, formatPostDate } from '@/lib/blog/posts'
import { getMDXComponents } from '@/mdx-components'
import { marketingSiteEnabled, MARKETING_URL } from '@/lib/site'


export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  const { getBlogPosts } = await import('@/lib/blog/posts')
  return getBlogPosts().map((post) => ({ slug: post.slugs[0] }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) return {}
  return publicPageMetadata({
    title: post.data.title,
    description: post.data.description,
    path: `/blog/${slug}`,
    canonicalUrl: post.data.canonicalUrl,
  })
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) notFound()

  const { title, subtitle, overview, description, author, datePublished, dateModified, category, coverImage, coverImageAlt } = post.data
  const url = `${MARKETING_URL}/blog/${slug}`
  const imageUrl = coverImage ?? `${MARKETING_URL}/blog/${slug}/opengraph-image`
  const MDXContent = post.data.body

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: title,
        description,
        image: imageUrl,
        datePublished,
        dateModified: dateModified ?? datePublished,
        url,
        author: { '@type': 'Person', name: author, url: `${MARKETING_URL}/about` },
        publisher: { '@id': ORGANIZATION_ID },
        isPartOf: { '@id': WEBSITE_ID },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      },
    ],
  }

  return (
    <MarketingPage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
      />
      <PageHero eyebrow={category} title={title}>
        <p className="marketing-post-subtitle">{subtitle}</p>
        <p className="marketing-meta">
          <Link href="/about">{author}</Link>{' '}
          · <time dateTime={datePublished}>{formatPostDate(datePublished)}</time>
        </p>
      </PageHero>
      {coverImage && (
        <div className="marketing-container marketing-post-cover">
          <Image
            src={coverImage}
            alt={coverImageAlt ?? title}
            width={1200}
            height={630}
            priority
          />
        </div>
      )}
      <section className="marketing-section">
        <div className="marketing-container marketing-reading">
          {/*
            The "Google overview" box: a short, direct-answer paragraph
            written to be liftable by featured snippets / AI Overviews,
            distinct from the reader-facing lede that follows it in the MDX
            body. Rendered as its own visually distinct block, not folded
            into the article prose.
          */}
          <p className="marketing-post-overview">{overview}</p>
          <article className="space-y-6">
            <MDXContent components={getMDXComponents()} />
          </article>
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
        <div className="marketing-container marketing-post-call">
          <p>
            If you have any questions, meet with us. We&apos;d be glad to
            answer them.
          </p>
          <a className="marketing-button" href="https://dub.sh/talk-to-us">
            Book a call
          </a>
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
