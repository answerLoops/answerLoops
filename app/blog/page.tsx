import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav, Footer } from '@/components/marketing/chrome'
import { PageSchema } from '@/components/marketing/page-schema'
import { BLOG_POSTS, formatPostDate } from './posts'

export const metadata: Metadata = {
  title: 'AnswerLoops blog',
  description: 'Notes on running communities and support across Discord, Slack, forums, GitHub, email, and more with AnswerLoops.',
  alternates: { canonical: '/blog' },
}

export default function BlogIndexPage() {
  return (
    <div className="min-h-screen bg-white">
      <PageSchema
        name="AnswerLoops blog"
        description="Notes on running communities and support across multiple platforms with AnswerLoops."
        path="/blog"
        type="CollectionPage"
      />
      <Nav />

      <section className="bg-ink-950 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60 mb-6">
            Blog
          </span>
          <h1 className="text-4xl font-bold text-white sm:text-5xl">From the team running it</h1>
          <p className="mt-5 text-lg text-white/60 max-w-2xl mx-auto">
            Notes on community support, written by the people who use AnswerLoops to run their own communities.
          </p>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-2xl px-6">
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {BLOG_POSTS.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="group block py-8">
                <time dateTime={post.datePublished} className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {formatPostDate(post.datePublished)}
                </time>
                <h2 className="mt-2 text-xl font-semibold text-gray-900 group-hover:text-brand-700">{post.title}</h2>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{post.description}</p>
                <span className="mt-3 inline-block text-sm font-medium text-brand-600">Read →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
