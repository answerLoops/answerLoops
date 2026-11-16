import type { Metadata } from 'next'
import Link from 'next/link'
import { START_HREF, PRICING_HREF } from '@/components/marketing/nav-shared'
import { redirect } from 'next/navigation'
import { AnswerLoopOverview } from '@/components/marketing/answer-loop-overview'
import { VerifiedAnswerMock, VerifiedAnswerSteps } from '@/components/marketing/verified-answer-mock'
import { WebsiteChatMock, WebsiteChatSteps } from '@/components/marketing/website-chat-diagram'
import { FeatureShowcase } from '@/components/marketing/feature-showcase'
import { MarketingPage, TrialCta } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORDERED_PLANS } from '@/lib/billing/plans'
import { INCLUDED_AI_SUMMARY, TRIAL_CTA_NOTE } from '@/lib/marketing/plan-summary'
import { marketingSiteEnabled } from '@/lib/site'
import { ORGANIZATION_ID } from '@/lib/site-identity'
import { ArrowRight, MessageCircle, Terminal, GraduationCap, Users, Palette, Blocks, Building2 } from 'lucide-react'

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
    a: INCLUDED_AI_SUMMARY,
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
    a: 'Start with the agent onboarding guide and connect your AI agent to your answerLoops workspace. Agents that support skills can use answerloops-operate for guided setup. Other compatible AI tools can connect through MCP or the REST API. Create an API key in Settings → API Keys and choose what your agent can access.',
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
        'Monthly subscription with a 14-day trial. AI usage is included up to a limit; connect your own provider to remove it.',
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
        <div className="marketing-container marketing-home-grid home-hero-stacked">
          <div className="home-hero-copy">
            <h1>
              AI community support from your docs
            </h1>
            {/* One sentence on purpose: the overview below shows the steps and
                the channel row, so the intro only states the outcome. */}
            <p className="marketing-intro">
              Every reply in your community channels is drafted from your docs
              and checked by a second AI.
            </p>
            <div className="marketing-actions">
              <Link
                href={START_HREF}
                className="marketing-button marketing-button-hero"
              >
                Start your free trial
                <ArrowRight size={18} strokeWidth={2.25} aria-hidden="true" />
              </Link>
            </div>
            <p className="marketing-note">
              {TRIAL_CTA_NOTE}
            </p>
          </div>
          <AnswerLoopOverview />
        </div>
      </section>
      <section id="website-chat" className="marketing-section scroll-mt-20">
        <div className="marketing-container chat-section">
          <div className="chat-section-copy">
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
            <p className="chat-section-lead">
              Visitors get answers from the articles you publish, right on the
              page they’re reading. Paste one snippet into your site and choose
              which domains it runs on.
            </p>
            <WebsiteChatSteps />
            <Link href="/docs/product/chat-widget" className="marketing-text-link">
              Install the website chat widget
            </Link>
          </div>
          <WebsiteChatMock />
        </div>
      </section>
      <section id="how-it-works" className="marketing-section marketing-soft scroll-mt-20">
        <div className="marketing-container chat-section chat-section-flip">
          <div className="chat-section-copy">
            <h2>Answers are verified before they reach your community</h2>
            <p className="chat-section-lead">
              Every answer is written from your docs, then checked against them
              by a second AI agent before anyone sees it.
            </p>
            <VerifiedAnswerSteps />
            <Link className="marketing-text-link" href="/support-workflow">
              See the reply settings
            </Link>
          </div>
          <VerifiedAnswerMock />
        </div>
      </section>
      <section id="features" className="marketing-section scroll-mt-20">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">Inside the workspace</p>
              <h2>Everything your team needs to run community support</h2>
            </div>
            <p>
              One workspace for every channel, from the first question to the
              article that answers the next one.
            </p>
          </div>
          <FeatureShowcase />
        </div>
      </section>
      <section className="mid-cta" aria-labelledby="mid-cta-title">
        <div className="marketing-container mid-cta-inner">
          <div>
            <h2 id="mid-cta-title">Try it with your own community</h2>
            <p>{TRIAL_CTA_NOTE}</p>
          </div>
          <Link href={START_HREF} className="marketing-button marketing-button-hero">
            Start your free trial
            <ArrowRight size={18} strokeWidth={2.25} aria-hidden="true" />
          </Link>
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
      <section id="who-its-for" className="marketing-section audience-section scroll-mt-20">
        <div className="marketing-container">
          <div className="audience-heading">
            <h2>Support for any community</h2>
            <p>
              If your members ask the same questions and you have docs that
              answer them, answerLoops fits.
            </p>
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
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section sales-strip-section">
        <div className="marketing-container sales-strip">
          <div>
            <h2>Need a custom setup?</h2>
            <p>
              Custom model endpoints, migration from another support tool, or
              onboarding help for a larger team.
            </p>
          </div>
          <div className="sales-strip-actions">
            <a href="https://dub.sh/talk-to-us" className="marketing-button">
              Talk to us
            </a>
            <Link
              href={PRICING_HREF}
              className="marketing-button marketing-button-secondary"
            >
              Compare plans
            </Link>
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
