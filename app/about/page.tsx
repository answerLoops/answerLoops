import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav, Footer, GITHUB_URL } from '@/components/marketing/chrome'
import { PageSchema } from '@/components/marketing/page-schema'
import { channelListSentence } from '@/lib/marketing/channels'

export const metadata: Metadata = {
  title: 'About AnswerLoops',
  description: "AnswerLoops is built by Nathan and Faith Tarbert — a former commercial truck driver and a former banker who taught themselves to code, started running online communities, and built the tool they needed to run them well.",
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <PageSchema
        name="About AnswerLoops"
        description="The story behind AnswerLoops — built by Nathan and Faith Tarbert after a career change into tech and community management."
        path="/about"
      />
      <Nav />

      <section className="bg-ink-950 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60 mb-6">
            About
          </span>
          <h1 className="text-4xl font-bold text-white sm:text-5xl">Built by two people who needed it</h1>
          <p className="mt-5 text-lg text-white/60 max-w-2xl mx-auto">
            AnswerLoops started as a tool we built for ourselves, because the tool we needed didn&apos;t exist yet.
          </p>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-2xl px-6">
          <div className="space-y-6 text-base leading-relaxed text-gray-600">
            <p>
              AnswerLoops is built by Nathan and Faith Tarbert, a husband-and-wife team who came to software late and
              on purpose.
            </p>
            <p>
              Nathan spent 21 years as a commercial truck driver. Faith worked in banking. Neither of us set out to
              build a company, let alone one that writes code — but in 2020 we both went back to school, learned to
              program, and started moving into tech from two very different directions.
            </p>
            <p>
              Along the way we started running online communities of our own. That&apos;s where the real problem
              showed up: the same questions kept coming in, over and over, across every platform we used to talk to
              people — Discord, a forum, email, a chat widget on our own site. Answering them well took real time, and
              answering them badly (or late, or inconsistently across platforms) cost trust. There wasn&apos;t a tool
              that actually solved this for a small team without either dumbing the answers down or requiring a
              support department we didn&apos;t have.
            </p>
            <p>
              So we built one, for ourselves, to run our own communities. It got good enough to trust with real
              answers, in the actual places our members asked — {channelListSentence()} — and it kept improving
              itself as we used it. That tool became AnswerLoops.
            </p>
            <p>
              We&apos;re still the two people running it, still building it in public, and it&apos;s still shaped by
              running our own communities with it every day. The code is open source (AGPL-3.0) because the tool we
              wished existed in 2020 should be one anyone can run themselves, not just something you rent.
            </p>
          </div>

          <div className="mt-14 rounded-2xl border-2 border-gray-200 bg-gray-50 p-8 text-center">
            <h2 className="text-xl font-bold text-gray-900">See what we built</h2>
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
        </div>
      </section>

      <Footer />
    </div>
  )
}
