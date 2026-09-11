import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav, Footer, GITHUB_URL } from '@/components/marketing/chrome'
import { PageSchema } from '@/components/marketing/page-schema'

export const metadata: Metadata = {
  title: 'AnswerLoops alternatives and comparisons',
  description: 'How AnswerLoops compares to Chatbase, Intercom, Plain, Pylon, and Zendesk AI — confidence-gated auto-answer, multi-channel ingest, self-hosting, and bring-your-own-LLM.',
  alternates: { canonical: '/alternatives' },
}

const COMPARISONS = [
  { slug: 'chatbase', name: 'Chatbase', summary: 'a website chat widget trained on your uploaded docs and URLs.' },
  { slug: 'intercom', name: 'Intercom', summary: 'a full customer messaging platform with a broad support/marketing/sales suite.' },
  { slug: 'plain', name: 'Plain', summary: 'a support-desk tool built around Slack-based ticket handling.' },
  { slug: 'pylon', name: 'Pylon', summary: 'a B2B customer-support platform for shared Slack/Teams channels.' },
  { slug: 'zendesk-ai', name: 'Zendesk AI', summary: "Zendesk's AI features layered onto its existing help-desk suite." },
]

export default function AlternativesPage() {
  return (
    <div className="min-h-screen bg-white">
      <PageSchema
        name="AnswerLoops alternatives and comparisons"
        description="Feature-by-feature comparisons between AnswerLoops and other AI support tools."
        path="/alternatives"
        type="CollectionPage"
        breadcrumbs={[{ name: 'Comparisons', path: '/pricing' }]}
      />
      <Nav />

      <section className="bg-ink-950 py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <span className="inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60 mb-6">
            Alternatives
          </span>
          <h1 className="text-4xl font-bold text-white sm:text-5xl">AnswerLoops alternatives</h1>
          <p className="mt-5 text-lg text-white/60 max-w-2xl mx-auto">
            AnswerLoops answers support questions across Discord, Slack, Discourse, Circle, GitHub, Telegram, email, and a
            website widget — one confidence-gated pipeline, one knowledge base, and self-hostable so the data never leaves your environment.
          </p>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {COMPARISONS.map((c) => (
              <Link
                key={c.slug}
                href={`/vs/${c.slug}`}
                className="group rounded-2xl border border-gray-100 p-6 transition-colors hover:border-brand-200 hover:bg-brand-50/20"
              >
                <div className="text-base font-semibold text-gray-900 group-hover:text-brand-700">
                  AnswerLoops vs {c.name}
                </div>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{c.summary}</p>
                <span className="mt-4 inline-block text-sm font-medium text-brand-600">Compare →</span>
              </Link>
            ))}
          </div>

          <div className="mt-14 rounded-2xl border-2 border-gray-200 bg-gray-50 p-8 text-center">
            <h2 className="text-xl font-bold text-gray-900">Try AnswerLoops free</h2>
            <p className="mt-2 text-sm text-gray-500">Self-host, or start a 14-day free trial on a hosted plan.</p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Clone on GitHub
              </Link>
              <Link href="/#pricing" className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:from-brand-500 hover:to-brand-400 transition-colors">
                See hosted plans
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
