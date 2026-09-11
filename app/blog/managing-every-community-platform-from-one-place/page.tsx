import type { Metadata } from 'next'
import Link from 'next/link'
import {
  MarketingPage,
  PageHero,
  TrialCta,
} from '@/components/marketing/layout'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORGANIZATION_ID, WEBSITE_ID } from '@/lib/site-identity'
import { channelListSentence } from '@/lib/marketing/channels'
import { getBlogPost, formatPostDate } from '../posts'

const post = getBlogPost('managing-every-community-platform-from-one-place')!

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  alternates: { canonical: `/blog/${post.slug}` },
}

export default function ManagingEveryPlatformPost() {
  const url = `https://answerloops.com/blog/${post.slug}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.datePublished,
        dateModified: post.datePublished,
        url,
        author: { '@type': 'Person', name: post.author },
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
      <PageHero eyebrow="From the founders" title={post.title}>
        <p className="marketing-meta">
          <time dateTime={post.datePublished}>
            {formatPostDate(post.datePublished)}
          </time>{' '}
          · {post.author}
        </p>
      </PageHero>
      <section className="marketing-section">
        <article className="marketing-container marketing-reading space-y-6">
          <p>
            A community can have several places to ask for help: Discord for
            conversation, a forum for longer discussions, GitHub for project
            issues, and email for people who do not use the other channels. The
            support team still has to recognize when two questions need the same
            answer.
          </p>
          <p>
            We encountered this while running our own communities. The difficult
            part was keeping track of what had already been answered and whether
            that explanation was still correct.
          </p>
          <h2>Keep questions in one queue</h2>
          <p>
            AnswerLoops connects to {channelListSentence()}. Questions become
            tickets with their source attached, so the team can review requests
            together and reply in the conversation where each one started.
          </p>
          <h2>Maintain the knowledge behind the answers</h2>
          <p>
            The drafting step searches the workspace knowledge base. A separate
            AI review compares the draft with the available sources. Better
            documentation gives both steps more useful material, so importing
            the docs is only the beginning: someone still needs to correct
            outdated instructions and fill gaps.
          </p>
          <p>
            When a resolved ticket contains an explanation other users will
            need, the team can promote it into the knowledge base. That makes
            the answer available to future questions across connected channels.
          </p>
          <h2>Choose when replies can be automatic</h2>
          <p>
            Automatic replies are off by default. We recommend reviewing
            representative drafts before enabling them for a channel. A
            qualifying reply needs to meet the configured confidence threshold;
            other drafts remain in the queue for a person to check and send.
          </p>
          <p>
            This gives the team a specific maintenance routine: review the
            tickets that need attention, inspect answer feedback, and improve
            the underlying articles. The quality of the source material remains
            part of the work.
          </p>
          <Link className="marketing-text-link" href="/support-workflow">
            See the support workflow →
          </Link>
        </article>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
