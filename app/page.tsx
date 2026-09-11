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
import {
  ArrowUpRight,
  BookOpen,
  GitBranch,
  Layers,
  Terminal,
  Network,
  ShieldCheck,
} from 'lucide-react'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

export const metadata: Metadata = {
  title: 'answerLoops — Agent infrastructure for support',
  description:
    'An answer agent drafts from your docs. A second agent reviews it. Connect community channels or give your own agents access through MCP. Open source and self-hostable.',
  alternates: { canonical: '/' },
}
const FAQ_ITEMS = [
  {
    q: 'What does answerLoops do?',
    a: 'answerLoops brings community support questions into one queue. It drafts replies from your knowledge base, checks those drafts against their sources, and gives your team control over when answers are sent.',
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
    q: 'Can I run answerLoops on my own infrastructure?',
    a: 'Yes. The source is available under AGPL-3.0. You operate the application and storage, configure the connected services, and cover your infrastructure and model costs.',
  },
  {
    q: 'Can my own agents use answerLoops?',
    a: 'Yes. Every hosted plan includes MCP and REST API access for searching knowledge, reading FAQs and tickets, generating answers, and creating support tickets. Usage limits depend on your plan.',
  },
]
export default function LandingPage() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'answerLoops',
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
        name="answerLoops — Agent infrastructure for support"
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
          <div className="home-hero-copy">
            <p className="marketing-eyebrow">
              <span className="eyebrow-dot" /> Agent infrastructure for support
            </p>
            <h1>
              An answer agent.
              <br />
              A review agent.
              <br />
              <em>Your expertise.</em>
            </h1>
            <p className="marketing-intro">
              Turn your documentation into answers your community can use. One
              agent writes the reply. A second checks the sources and confidence
              before your settings decide what gets sent.
            </p>
            <div className="marketing-actions">
              <Link
                href="/login"
                className="marketing-button marketing-button-hero"
              >
                Start a Free Trial for $0 <ArrowUpRight size={17} />
              </Link>
              <Link
                href="/docs/integrations/mcp"
                className="marketing-button marketing-button-secondary"
              >
                <Terminal size={17} /> Connect your agent
              </Link>
            </div>
            <p className="marketing-note">
              14-day trial. Card required. Start building your answer loop today.
            </p>
          </div>
          <AnimatedChat />
          <div
            id="integrations"
            className="channel-band scroll-mt-20"
            aria-label="Supported channels"
          >
            <p>Connect the channels your community uses.</p>
            <div className="marketing-channel-list">
              {MARKETED_CHANNELS.map(({ name, href, color }) => (
                <Link key={href} href={href}>
                  <IntegrationIcon name={name} color={color} />
                  <span>{name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section id="how-it-works" className="marketing-section scroll-mt-20">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">01 / The answer loop</p>
              <h2>
                An answer is a draft.
                <br />
                Until it’s been reviewed.
              </h2>
            </div>
            <p>
              Retrieval, generation, and review belong in the same workflow.
              answerLoops keeps the question, the source material, and the
              review together—before anything is sent.
            </p>
          </div>
          <WorkflowDiagram />
          <Link className="marketing-text-link mt-6" href="/support-workflow">
            Explore the answer lifecycle <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>
      <section className="mcp-section" aria-labelledby="mcp-title">
        <div className="marketing-container mcp-grid">
          <div>
            <p className="marketing-eyebrow">
              02 / An MCP server for your agent
            </p>
            <h2 id="mcp-title">
              Your agents need
              <br />
              answers, too.
            </h2>
            <p className="marketing-lead">
              Give coding assistants, internal agents, and custom tools access
              to the same knowledge and reviewed answers your community uses.
            </p>
            <p className="marketing-lead">
              Search docs. Generate an answer. Open a ticket when a person needs
              to step in. One workspace, through MCP or the REST API.
            </p>
            <div className="marketing-actions">
              <Link href="/docs/integrations/mcp" className="marketing-button">
                Read the MCP guide <ArrowUpRight size={16} />
              </Link>
              <Link className="marketing-text-link" href="/mcp-support-agents">
                Explore agent access →
              </Link>
            </div>
          </div>
          <div className="mcp-terminal">
            <div className="terminal-bar">
              <span>
                <Terminal size={16} /> answerLoops / MCP
              </span>
              <span>TOOL DIRECTORY</span>
            </div>
            <div className="terminal-endpoint">
              <span>HTTP</span>
              <code>/api/mcp</code>
            </div>
            {[
              ['search_kb', 'Find relevant answers in your knowledge base'],
              [
                'generate_answer',
                'Generate a source-grounded, reviewed answer',
              ],
              ['get_faq', 'Read your latest FAQ'],
              ['get_tickets', 'Retrieve support tickets'],
              ['create_ticket', 'Hand a question to your support workflow'],
            ].map(([tool, description]) => (
              <div className="terminal-tool" key={tool}>
                <code>
                  <span>↳</span> {tool}
                </code>
                <p>{description}</p>
              </div>
            ))}
            <div className="terminal-foot">
              <span className="eyebrow-dot" /> Available on every hosted plan
            </div>
          </div>
        </div>
      </section>
      <section id="features" className="marketing-section scroll-mt-20">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">
                03 / Built around your knowledge
              </p>
              <h2>
                The infrastructure behind
                <br />
                every useful reply.
              </h2>
            </div>
            <p>
              Connect what you know. Decide how agents act on it. Keep your team
              in control of the questions that need a person.
            </p>
          </div>
          <div className="capability-grid">
            {[
              {
                icon: BookOpen,
                number: '01',
                title: 'Knowledge your agents can use.',
                body: 'Import docs, files, GitHub repositories, and Notion pages. Save useful resolutions so the next answer starts with what your team already knows.',
                href: '/docs/product/knowledge-base',
                label: 'Knowledge sources',
                detail: 'DOCS  /  FILES  /  GITHUB  /  NOTION',
              },
              {
                icon: ShieldCheck,
                number: '02',
                title: 'Automation with reply controls.',
                body: 'Start with team approval. Enable automatic answers per channel when you’re ready. Questions below your confidence threshold stay with your team.',
                href: '/docs/product/ai-deflection',
                label: 'Answer review',
                detail: 'DRAFT  →  REVIEW  →  REPLY',
              },
              {
                icon: Layers,
                number: '03',
                title: 'Keep the conversation intact.',
                body: 'Review the question, draft, and source conversation in one ticket. Reply back to the original channel without losing the context.',
                href: '/docs/product/tickets',
                label: 'Support workspace',
                detail: 'QUESTION  +  SOURCES  +  HISTORY',
              },
              {
                icon: Network,
                number: '04',
                title: 'Learn where your docs fall short.',
                body: 'Use unanswered topics and customer ratings to decide what to document next. Knowledge-gap reports are included on Pro and Enterprise.',
                href: '/docs/product/knowledge-gaps',
                label: 'Knowledge gaps',
                detail: 'UNANSWERED  →  DOCUMENTED',
              },
            ].map(
              ({ icon: Icon, number, title, body, href, label, detail }) => (
                <article className="capability-card" key={title}>
                  <div className="capability-top">
                    <Icon size={25} strokeWidth={1.4} />
                    <span>{number}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <div className="capability-detail">{detail}</div>
                  <Link href={href} className="marketing-text-link">
                    {label}
                    <ArrowUpRight size={16} />
                  </Link>
                </article>
              ),
            )}
          </div>
        </div>
      </section>
      <section className="marketing-section marketing-soft deployment-section">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">04 / Your deployment</p>
              <h2>
                Choose where it runs.
                <br />
                Keep the same answer loop.
              </h2>
            </div>
            <p>
              Use our hosted service or operate the open-source application on
              your own infrastructure. Connect your preferred supported model
              provider.
            </p>
          </div>
          <div className="deployment-grid">
            <article>
              <span className="deployment-symbol">
                <Layers size={28} />
              </span>
              <h3>We run the infrastructure.</h3>
              <p>
                Start with a hosted workspace. Connect your knowledge and
                channels, then review your first answers.
              </p>
              <Link href="/pricing" className="marketing-text-link">
                Explore hosted plans <ArrowUpRight size={16} />
              </Link>
            </article>
            <article>
              <span className="deployment-symbol">
                <GitBranch size={28} />
              </span>
              <h3>You run the infrastructure.</h3>
              <p>
                Deploy the AGPL-3.0 source. Manage your application, storage,
                updates, and connected services.
              </p>
              <Link
                href="/self-hosted-ai-support"
                className="marketing-text-link"
              >
                Explore self-hosting <ArrowUpRight size={16} />
              </Link>
            </article>
          </div>
          <div className="enterprise-line">
            <span>
              Custom model endpoints, migration assistance, or deployment
              requirements?
            </span>
            <a href="mailto:hello@answerloops.com">
              Talk to us about Enterprise ↗
            </a>
            <a href={GITHUB_URL}>View source ↗</a>
          </div>
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
