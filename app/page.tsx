import type { Metadata } from 'next'
import Link from 'next/link'
import { START_HREF, PRICING_HREF } from '@/components/marketing/nav-shared'
import { redirect } from 'next/navigation'
import { AnimatedChat } from '@/components/marketing/animated-chat'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'
import { MarketingPage, TrialCta } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORDERED_PLANS } from '@/lib/billing/plans'
import { GITHUB_SOURCE_URL, marketingSiteEnabled } from '@/lib/site'
import { ORGANIZATION_ID } from '@/lib/site-identity'
import { BookOpen, ShieldCheck, MessageCircle, MessagesSquare, FileQuestion, Cloud, Server, Terminal, GraduationCap, Users, Palette, Blocks, Building2 } from 'lucide-react'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

export const dynamic = 'force-dynamic'
const PAGE_TITLE = 'AI community support from your docs | answerLoops'
const PAGE_DESCRIPTION =
  'Answer community questions from your documentation, add chat to your website, and connect your own AI agent through skills, MCP, or the REST API.'
export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'answerLoops',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
}
const FAQ_ITEMS = [
  {
    q: 'What does answerLoops do?',
    a: 'answerLoops collects questions from your community channels and drafts replies using your documented knowledge. A separate AI review checks each draft against its sources. You can approve replies yourself or enable automatic replies for individual channels. Useful resolutions can be saved for future questions.',
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
    a: 'Your first five help tickets include AI processing at no extra charge. To continue, connect an account with a supported AI service (like Anthropic or OpenAI) that powers the answers. You pay that service directly for AI usage, separately from your answerLoops subscription.',
  },
  {
    q: 'Can I run answerLoops on my own infrastructure?',
    a: 'Yes. The source is available under AGPL-3.0. You operate the application and storage, configure the connected services, and cover your infrastructure and model costs.',
  },
  {
    q: 'Can I add the chat widget to my website or docs?',
    a: 'Yes. Add the embed snippet to any website or documentation platform that supports custom JavaScript, and configure its allowed domains in Settings. The widget answers from published knowledge-base articles, and visitors do not need an account.',
  },
  {
    q: 'Is answerLoops only for developer communities?',
    a: 'No. It can use your guides and FAQs to answer questions in art, crypto, course, membership, and general-interest communities, as well as developer communities. The answers depend on the documentation you provide.',
  },
  {
    q: 'How do I onboard an AI agent? (optional)',
    a: 'Start with the agent onboarding guide and connect your AI agent to your answerLoops workspace. Agents that support skills can use answerloops-operate for guided setup. Other compatible AI tools can connect through MCP or the REST API. Create an API key in Settings → API Keys and choose what your agent can access. For self-hosting, the answerloops-setup skill guides compatible agents through installation.',
  },
  {
    q: 'Can my own AI agents use answerLoops? (optional)',
    a: 'Yes. Every hosted plan includes MCP and REST API access for searching knowledge, reading FAQs and tickets, generating answers, and creating support tickets. Usage limits depend on your plan.',
  },
]
export default function LandingPage() {
  // A self-hosted install has already chosen not to buy a hosted plan, so the
  // landing page is at best noise and at worst a checkout funnel pointing at
  // our Stripe account. Root goes where a self-hoster actually wants it: the
  // product. Unauthenticated requests carry on to /login from there.
  if (!marketingSiteEnabled()) redirect('/dashboard')

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
        name={PAGE_TITLE}
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
            <p className="marketing-eyebrow hero-positioning">
              <span className="hero-positioning-dot" aria-hidden="true" />
              Agent-native AI support
            </p>
            <h1>
              Faster answers. More time to create.
            </h1>
            <p className="marketing-intro">
              Turn your docs into answers wherever your community asks. Keep
              your team in control, or put your own AI agents to work.
            </p>
            <div className="marketing-actions">
              <Link
                href={START_HREF}
                className="marketing-button marketing-button-hero"
              >
                Try answerLoops for 14 days
              </Link>
              <Link
                href="https://dub.sh/onboard-agent-skills"
                className="marketing-button marketing-button-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Onboard your AI agent
              </Link>
            </div>
            <p className="marketing-note">
              A card is required. Cancel within 14 days to avoid the subscription charge.
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
              <p className="marketing-eyebrow">How replies work</p>
              <h2>
                Check the answer before it reaches your community
              </h2>
            </div>
            <p>
              Every draft is checked against the knowledge used to write it.
              Keep replies in your team’s queue for approval, or enable
              automatic replies for a channel after testing the results.
            </p>
          </div>
          <WorkflowDiagram />
          <Link className="marketing-text-link mt-6" href="/support-workflow">
            See the reply settings
          </Link>
        </div>
      </section>
      <section id="website-chat" className="marketing-section marketing-soft scroll-mt-20">
        <div className="marketing-container marketing-section-heading">
          <div>
            <p className="marketing-eyebrow flex items-center gap-3">
              <MessageCircle
                size={24}
                strokeWidth={1.75}
                className="shrink-0 text-[var(--marketing-link)]"
                aria-hidden="true"
              />
              Website chat widget
            </p>
            <h2>Add a support chatbot to any website or documentation site</h2>
          </div>
          <div>
            <p>
              Give visitors a place to ask questions while they read your site.
              The answerLoops chat widget answers from the knowledge-base articles
              you publish, whether you run a community, a business website, or
              product documentation.
            </p>
            <p className="mt-4">
              Copy the embed snippet from Settings, add it to your website, and
              list the domains where it should appear. Your site needs to allow
              custom JavaScript; visitors don’t need an answerLoops account.
            </p>
            <Link href="/docs/product/widget" className="marketing-text-link mt-4">
              Install the website chat widget
            </Link>
          </div>
        </div>
      </section>
      <section className="mcp-section" aria-labelledby="mcp-title">
        <div className="marketing-container mcp-grid">
          <div>
            <p className="marketing-eyebrow">
              MCP and API access for AI agents
            </p>
            <h2 id="mcp-title">
              Let AI tools use the same support knowledge
            </h2>
            <p className="marketing-lead">
              Give coding assistants, internal agents, and custom tools access
              to the same knowledge and reviewed answers your community uses.
            </p>
            <p className="marketing-lead">
              Through MCP or the REST API, an agent can search your docs,
              prepare an answer, or open a ticket for your team to follow up.
            </p>
            <div className="marketing-actions">
              <Link href="/docs/integrations/mcp" className="marketing-button">
                Read the MCP guide
              </Link>
              <Link className="marketing-button marketing-button-secondary" href="/mcp-support-agents">
                Connect your agent
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
                Managing community support
              </p>
              <h2>
                Manage your knowledge base and community support in one place.
              </h2>
            </div>
            <p>
              Good answers depend on your knowledge base. Keep track of the
              sources you import, the replies your team sends, and the questions
              your docs don’t cover yet.
            </p>
          </div>
          <div className="capability-grid">
            {[
              {
                icon: BookOpen,
                title: 'Import any documentation you already have',
                body: 'Import docs, files, GitHub repositories, and Notion pages. Save useful resolutions so the next answer starts with what your team already knows.',
                href: '/docs/product/knowledge-base',
                label: 'Knowledge sources',
              },
              {
                icon: ShieldCheck,
                title: 'Choose which community channels can reply automatically',
                body: 'Start with team approval. Enable automatic answers per channel when you’re ready. Questions below your confidence threshold stay with your team.',
                href: '/docs/product/ai-deflection',
                label: 'Answer review',
              },
              {
                icon: MessagesSquare,
                title: 'Reply in the original conversation',
                body: 'Review the question, draft, and source conversation in one ticket. Reply back to the original channel without losing the context.',
                href: '/docs/product/tickets',
                label: 'Support workspace',
              },
              {
                icon: FileQuestion,
                title: 'Expose community knowledge gaps',
                body: 'Use unanswered topics and customer ratings to decide what to document next. Knowledge-gap reports are included on Pro and Enterprise.',
                href: '/docs/product/knowledge-gaps',
                label: 'Knowledge gaps',
              },
            ].map(
              ({ icon: Icon, title, body, href, label }) => (
                <article className="capability-card" key={title}>
                  <div className="capability-top">
                    <Icon size={25} strokeWidth={1.4} aria-hidden="true" />
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <Link
                    href={href}
                    className="marketing-text-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {label}
                  </Link>
                </article>
              ),
            )}
          </div>
        </div>
      </section>
      <section className="marketing-section marketing-soft deployment-section">
        <div className="marketing-container">
          <div className="marketing-section-heading hosting-heading">
            <div>
              <p className="marketing-eyebrow">Hosting</p>
              <h2>
                Choose how you host answerLoops
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
              <div className="hosting-option-heading">
              <span className="deployment-symbol">
                <Cloud size={28} aria-hidden="true" />
              </span>
              <h3>Managed hosting</h3>
              </div>
              <p>
                Start with a hosted workspace. Connect your knowledge and
                channels, then review your first answers.
              </p>
              <Link href={PRICING_HREF} className="marketing-button marketing-button-secondary">
                Explore hosted plans
              </Link>
            </article>
            <article>
              <div className="hosting-option-heading">
              <span className="deployment-symbol">
                <Server size={28} aria-hidden="true" />
              </span>
              <h3>Self-hosted</h3>
              </div>
              <p>
                Deploy the AGPL-3.0 source. Manage your application, storage,
                updates, and connected services.
              </p>
              <Link
                href="/self-hosted-ai-support"
                className="marketing-button marketing-button-secondary"
              >
                Explore self-hosting
              </Link>
            </article>
          </div>
          <div className="enterprise-line hosting-enterprise">
            <div className="hosting-enterprise-copy">
              <h3>Need help with your deployment?</h3>
            <p>
              Custom model endpoints, migration assistance, or deployment
              requirements.
            </p>
            </div>
            <div className="hosting-enterprise-actions">
            <a
              href="https://dub.sh/talk-to-us"
              className="marketing-button"
            >
              Talk to us
            </a>
            <a
              href={GITHUB_SOURCE_URL}
              className="marketing-button marketing-button-secondary"
            >
              View source
            </a>
            </div>
          </div>
        </div>
      </section>
      <section id="who-its-for" className="marketing-section scroll-mt-20">
        <div className="marketing-container">
          <div className="marketing-section-heading marketing-section-heading-center">
            <h2>
              Support for any community
            </h2>
          </div>
          <div className="audience-grid">
            {[
              {
                icon: Terminal,
                title: 'Developer communities',
                body: 'Use your setup guides and troubleshooting docs to answer recurring questions in Discord, Slack, and website chat.',
              },
              {
                icon: GraduationCap,
                title: 'Courses and membership groups',
                body: 'Help students find course instructions and answers in Discord and Circle, with questions that need your attention kept in the team queue.',
              },
              {
                icon: Users,
                title: 'General-interest communities',
                body: 'Answer questions about community rules, events, and getting started in Discourse and Circle using the guides your moderators maintain.',
              },
              {
                icon: Palette,
                title: 'Art and creative communities',
                body: 'Help members find submission rules, workshop instructions, and print specifications from your community guides.',
              },
              {
                icon: Blocks,
                title: 'Crypto and Web3 communities',
                body: 'Answer questions about project documentation, participation rules, and getting started in Telegram and Discord.',
              },
              {
                icon: Building2,
                title: 'Businesses and organizations',
                body: 'Use your service documentation to answer common client questions in email and website chat.',
              },
            ].map(({ icon: Icon, title, body }) => (
              <article className="audience-card" key={title}>
                <span className="audience-icon">
                  <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
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
