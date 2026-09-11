import type { Metadata } from 'next'
import Link from 'next/link'
import {
  MarketingPage,
  PageHero,
  TrialCta,
} from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
export const metadata: Metadata = {
  title: 'Compare answerLoops',
  description:
    'Compare answerLoops with Intercom, Chatbase, Plain, Pylon, and Zendesk AI.',
  alternates: { canonical: '/alternatives' },
}
const COMPARISONS = [
  {
    slug: 'intercom',
    name: 'Intercom',
    summary:
      'Intercom combines a helpdesk with Fin, its AI customer agent. Fin also connects to other helpdesks.',
  },
  {
    slug: 'chatbase',
    name: 'Chatbase',
    summary:
      'Chatbase offers AI agents for chat, email, and voice, with a helpdesk for AI and human conversations.',
  },
  {
    slug: 'plain',
    name: 'Plain',
    summary:
      'Plain offers a B2B support workspace, AI assistants and agents, workflows, and APIs.',
  },
  {
    slug: 'pylon',
    name: 'Pylon',
    summary:
      'Pylon combines B2B support with customer context, AI agents, and account and product intelligence.',
  },
  {
    slug: 'zendesk-ai',
    name: 'Zendesk AI',
    summary:
      'Zendesk offers a support suite with ticketing, AI agents, and additional products for support operations.',
  },
]
export default function AlternativesPage() {
  return (
    <MarketingPage>
      <PageSchema
        name="Compare answerLoops"
        description="Product comparisons for teams evaluating AI support."
        path="/alternatives"
        type="CollectionPage"
      />
      <PageHero
        eyebrow="Comparisons"
        title="Choose the support workflow your team needs."
      >
        <p>
          Compare channels, answer review, deployment, and operating costs. Each
          comparison links to the competitor’s published information and
          includes a review date.
        </p>
      </PageHero>
      <section className="marketing-section">
        <div className="marketing-container marketing-grid">
          {COMPARISONS.map((c) => (
            <article className="marketing-card" key={c.slug}>
              <h2 className="!text-xl">answerLoops vs {c.name}</h2>
              <p>{c.summary}</p>
              <Link className="marketing-text-link" href={`/vs/${c.slug}`}>
                Compare {c.name} →
              </Link>
            </article>
          ))}
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
