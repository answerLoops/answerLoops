import type { Metadata } from 'next'
import Link from 'next/link'
import { AnimatedChat } from '@/components/animated-chat'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'
import { MarketingPage, TrialCta } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORDERED_PLANS } from '@/lib/billing/plans'
import { GITHUB_URL } from '@/lib/site'
import { ORGANIZATION_ID } from '@/lib/site-identity'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

export const metadata: Metadata = {
  title: 'AnswerLoops — AI support for your community',
  description:
    'Draft support replies from your documentation, review answers with their sources, and manage questions across your community channels. Open source and self-hostable.',
  alternates: { canonical: '/' },
}
const FAQ_ITEMS = [
  {
    q: 'What does AnswerLoops do?',
    a: 'AnswerLoops brings community support questions into one queue. It drafts replies from your knowledge base, checks those drafts against their sources, and gives your team control over when answers are sent.',
  },
  {
    q: 'Can I review answers before they are sent?',
    a: 'Yes. Automatic replies are off by default on newly connected channels. Review drafts first, then enable automatic replies for the channels where you want them. Questions that need attention stay in your team’s queue.',
  },
  {
    q: 'What can I use as a knowledge source?',
    a: 'Import documentation pages, upload files, or connect a GitHub repository or Notion workspace. You can also save useful ticket resolutions to the knowledge base.',
  },
  {
    q: 'Do I need an AI provider account?',
    a: 'New hosted workspaces include a one-time allowance of five AI-processed tickets. After that, connect your provider account and pay its usage charges directly. Custom model endpoints are available on Enterprise and self-hosted deployments.',
  },
  {
    q: 'Can I run AnswerLoops on my own infrastructure?',
    a: 'Yes. The source is available under AGPL-3.0. You operate the application and storage, configure the connected services, and cover your infrastructure and model costs.',
  },
  {
    q: 'Can my own agents use AnswerLoops?',
    a: 'Yes. Every hosted plan includes MCP and REST API access for searching knowledge, reading FAQs and tickets, generating answers, and creating support tickets. Usage limits depend on your plan.',
  },
]
export default function LandingPage() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AnswerLoops',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    provider: { '@id': ORGANIZATION_ID },
    offers: ORDERED_PLANS.map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: (p.priceMonthly / 100).toString(),
      priceCurrency: 'USD',
      description:
        'Monthly subscription with a 14-day trial. Model usage is billed separately by your provider.',
    })),
  }
  return (
    <MarketingPage>
      <PageSchema
        name="AnswerLoops — AI support for your community"
        description={metadata.description!}
        path="/"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdHtml({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQ_ITEMS.map((item) => ({
              '@type': 'Question',
              name: item.q,
              acceptedAnswer: { '@type': 'Answer', text: item.a },
            })),
          }),
        }}
      />
      <section className="marketing-home-hero">
        <div className="marketing-container marketing-home-grid">
          <div>
            <p className="marketing-eyebrow">AI support for community teams</p>
            <h1>Answer community questions from your documentation.</h1>
            <p className="marketing-intro">
              Bring questions into one support queue. Review replies with their
              sources, and enable automatic answers in the channels you choose.
            </p>
            <div className="marketing-actions">
              <Link href="/login" className="marketing-button">
                Start a 14-day trial
              </Link>
              <Link
                href="/support-example"
                className="marketing-button marketing-button-secondary"
              >
                See an example
              </Link>
            </div>
            <p className="marketing-note">
              Card required. Cancel before the trial ends to avoid the
              subscription charge.{' '}
              <Link href="/pricing" className="underline">
                View plans and model costs.
              </Link>
            </p>
          </div>
          <AnimatedChat />
        </div>
      </section>
      <section
        id="integrations"
        className="marketing-section marketing-soft scroll-mt-20"
        aria-label="Supported channels"
      >
        <div className="marketing-container">
          <p className="marketing-eyebrow">
            Connect the channels your community uses
          </p>
          <div className="marketing-channel-list">
            {MARKETED_CHANNELS.map(({ name, href }) => (
              <Link key={href} href={href}>
                {name}
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section id="how-it-works" className="marketing-section scroll-mt-20">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">From question to reply</p>
              <h2>
                Review drafts. Choose where answers can post automatically.
              </h2>
            </div>
            <p>
              Start with team approval while you evaluate answers against your
              own documentation. Keep that review process, or enable automatic
              replies channel by channel.
            </p>
          </div>
          <WorkflowDiagram />
          <Link className="marketing-text-link mt-6" href="/support-workflow">
            Follow a question through the workflow →
          </Link>
        </div>
      </section>
      <section
        id="features"
        className="marketing-section marketing-soft scroll-mt-20"
      >
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">Your support workspace</p>
              <h2>Give every question a place to be handled.</h2>
            </div>
            <p>
              Keep the source conversation, supporting knowledge, and suggested
              reply together so your team can decide what to send.
            </p>
          </div>
          <div className="marketing-grid">
            {[
              [
                'Use the knowledge you already have',
                'Import your documentation, files, GitHub repositories, and Notion pages. Save approved resolutions so future answers can draw on them.',
                '/docs/product/knowledge-base',
                'Explore knowledge sources',
              ],
              [
                'Review tickets across channels',
                'Filter questions by source, priority, category, and status. Open a ticket to review its draft and reply to the original conversation.',
                '/docs/product/tickets',
                'See the ticket workflow',
              ],
              [
                'Find questions your docs do not answer',
                'Review unanswered topics and customer ratings. Use these signals to decide which documentation to write or improve.',
                '/docs/product/knowledge-gaps',
                'Explore knowledge gaps',
              ],
              [
                'Connect your own agents',
                'Use MCP or the REST API to search support knowledge, retrieve FAQs, generate answers, and open tickets from your existing tools.',
                '/mcp-support-agents',
                'See agent access',
              ],
            ].map(([title, body, href, label]) => (
              <article className="marketing-card" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
                <Link className="marketing-text-link mt-5" href={href}>
                  {label} →
                </Link>
              </article>
            ))}
          </div>
          <p className="marketing-note">
            Customer ratings, knowledge gaps, simulation, and escalation routing
            are included on Pro and Enterprise.{' '}
            <Link href="/pricing#comparison" className="underline">
              Compare plans.
            </Link>
          </p>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container marketing-grid">
          <div>
            <p className="marketing-eyebrow">Deployment</p>
            <h2>Use the hosted service or run it yourself.</h2>
            <p className="marketing-lead">
              We operate the hosted application. With self-hosting, your team
              manages the application, storage, updates, and connected services.
              The source is available under AGPL-3.0.
            </p>
            <div className="marketing-actions">
              <Link
                className="marketing-button marketing-button-secondary"
                href="/self-hosted-ai-support"
              >
                Explore self-hosting
              </Link>
              <a className="marketing-text-link self-center" href={GITHUB_URL}>
                View source on GitHub →
              </a>
            </div>
          </div>
          <article className="marketing-card">
            <p className="marketing-eyebrow">Enterprise</p>
            <h3>Plan your deployment and support requirements.</h3>
            <p>
              Enterprise includes unlimited automated answers, custom model
              endpoints, migration assistance, and dedicated support. Discuss
              SSO and SAML, audit logs, retention, service levels, and DPA or
              BAA requirements with our team.
            </p>
            <a
              className="marketing-text-link mt-5"
              href="mailto:hello@answerloops.com"
            >
              Discuss enterprise requirements →
            </a>
            <p className="marketing-note">
              Your agreement defines the service commitments for your
              deployment.
            </p>
          </article>
        </div>
      </section>
      <section id="faq" className="marketing-section marketing-soft">
        <div className="marketing-container marketing-reading">
          <p className="marketing-eyebrow">Before you start</p>
          <h2>Questions about setup and operation</h2>
          <div className="marketing-faq">
            {FAQ_ITEMS.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
