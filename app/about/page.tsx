import type { Metadata } from 'next'
import Link from 'next/link'
import {
  MarketingPage,
  PageHero,
  TrialCta,
} from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
export const metadata: Metadata = {
  title: 'About answerLoops',
  description:
    'Nathan and Faith Tarbert built answerLoops to manage support for their online communities.',
  alternates: { canonical: '/about' },
}
export default function AboutPage() {
  return (
    <MarketingPage>
      <PageSchema
        name="About answerLoops"
        description="The founders and the problem behind answerLoops."
        path="/about"
      />
      <PageHero
        eyebrow="About"
        title="Built from the work of running a community."
      >
        <p>
          We built answerLoops after answering the same support questions across
          the communities we managed.
        </p>
      </PageHero>
      <section className="marketing-section">
        <div className="marketing-container marketing-reading space-y-6">
          <h2>Nathan and Faith Tarbert</h2>
          <p>
            We are a husband-and-wife team. Nathan spent 21 years as a
            commercial truck driver; Faith worked in banking. In 2020, we went
            back to school and learned to program.
          </p>
          <p>
            As we moved into technology and started running online communities,
            support became part of our daily work. A question answered in
            Discord would appear again in a forum or an email. Finding the
            earlier explanation, checking it, and writing it again took time.
          </p>
          <p>
            We wanted a shared place for those questions and the documentation
            needed to answer them. answerLoops grew out of that work: receive a
            question, prepare a reply from existing knowledge, review it, and
            keep useful resolutions available for the next person.
          </p>
          <h2>How we build it</h2>
          <p>
            We still run the company and use answerLoops in our own communities.
            The source is available under AGPL-3.0, and teams can use the hosted
            service or operate a deployment themselves.
          </p>
          <p>
            For product questions, deployment requirements, or feedback, contact
            us at{' '}
            <a
              className="marketing-text-link"
              href="mailto:hello@answerloops.com"
            >
              hello@answerloops.com
            </a>
            .
          </p>
          <div className="marketing-actions">
            <Link
              className="marketing-button marketing-button-secondary"
              href="/support-example"
            >
              Inspect an example
            </Link>
            <Link
              className="marketing-text-link"
              href="https://github.com/answerLoops/answerLoops"
            >
              View the source →
            </Link>
          </div>
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
