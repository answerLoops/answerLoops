import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav, Footer, GITHUB_URL } from '@/components/marketing/chrome'
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
    <div className="min-h-screen bg-white">
      {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <Nav />

      <section className="bg-ink-950 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <Link href="/blog" className="text-xs font-medium text-white/50 hover:text-white/80">← Blog</Link>
          <time dateTime={post.datePublished} className="mt-6 block text-xs font-medium uppercase tracking-wide text-white/40">
            {formatPostDate(post.datePublished)} · {post.author}
          </time>
          <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">{post.title}</h1>
        </div>
      </section>

      <section className="bg-white py-20">
        <article className="mx-auto max-w-2xl px-6">
          <div className="space-y-6 text-base leading-relaxed text-gray-600">
            <p>
              Every community ends up spread across more than one platform. A Discord for real-time chat, a forum
              (Discourse or Circle) for anything that should stick around and be searchable, GitHub Issues for the
              people actually using your code, email for whoever never joined the Discord at all, and — sooner or
              later — a chat widget on your own site for the people who land there first. That&apos;s five or six
              different inboxes, and the same handful of questions showing up in every one of them.
            </p>
            <p>
              The usual answer is to pick a favorite platform and let the rest go quiet, or to hire enough people to
              staff each one separately. Neither is great. The first means you&apos;re only actually present where
              your team happens to be watching; the second is a real budget line for a problem that&apos;s mostly the
              same question, asked in a different place.
            </p>

            <h2 className="pt-4 text-xl font-bold text-gray-900">One pipeline, not five</h2>
            <p>
              AnswerLoops connects to {channelListSentence()} and runs every one of them through the same pipeline:
              classify the question, search your knowledge base and past resolved tickets for a matching answer,
              draft a grounded response, and grade that response&apos;s confidence before it goes anywhere. A
              high-confidence answer posts automatically, in the same thread it came from, on whichever platform it
              came from. Anything the AI isn&apos;t sure about routes to a human queue with the draft already
              written, so a person is finishing an answer, not starting one from a blank page.
            </p>
            <p>
              The knowledge base is shared across all of it. A question answered well in Discord last week is
              available to answer the same question asked in GitHub Issues tomorrow, or in a DM to the website
              widget next month. You&apos;re not maintaining five separate FAQs that drift out of sync with each
              other — there&apos;s one source of truth, and every channel draws from it.
            </p>

            <h2 className="pt-4 text-xl font-bold text-gray-900">What that actually changes</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>A repeat question gets the same accurate answer no matter which platform it&apos;s asked on, instead of a different answer per channel depending on who&apos;s watching that day.</li>
              <li>Resolving a ticket well in one place makes every future channel smarter, because the resolution can be promoted straight into the knowledge base.</li>
              <li>You can actually be present everywhere your community already is, instead of picking one platform and hoping people follow you there.</li>
              <li>Nobody is bouncing between five separate dashboards to keep up — it&apos;s one queue, with the source platform attached to every ticket.</li>
            </ul>

            <h2 className="pt-4 text-xl font-bold text-gray-900">Why we built it this way</h2>
            <p>
              We didn&apos;t design this from a whiteboard — we built it running our own communities, where this was
              the actual daily problem. AnswerLoops is the tool we needed once we were answering the same question
              for the fourth time in a week, in a fourth different place. It&apos;s still what we use to run our own
              communities today.
            </p>
          </div>

          <div className="mt-14 rounded-2xl border-2 border-gray-200 bg-gray-50 p-8 text-center">
            <h2 className="text-xl font-bold text-gray-900">See it on your own communities</h2>
            <p className="mt-2 text-sm text-gray-500">Self-host for free (AGPL-3.0), or start a 14-day trial on a hosted plan.</p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Clone on GitHub
              </Link>
              <Link href="/#pricing" className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:from-brand-500 hover:to-brand-400 transition-colors">
                See hosted plans
              </Link>
            </div>
          </div>
        </article>
      </section>

      <Footer />
    </div>
  )
}
