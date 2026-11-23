import type { Metadata } from 'next'
import Link from 'next/link'
import {
  START_HREF,
  PRICING_HREF,
  TALK_TO_US_HREF,
} from '@/components/marketing/nav-shared'
import { redirect } from 'next/navigation'
import { AnswerLoopOverview } from '@/components/marketing/answer-loop-overview'
import { VerifiedAnswerMock, VerifiedAnswerSteps } from '@/components/marketing/verified-answer-mock'
import { WebsiteChatMock, WebsiteChatSteps } from '@/components/marketing/website-chat-diagram'
import { FeatureShowcase } from '@/components/marketing/feature-showcase'
import { MarketingPage, TrialCta } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORDERED_PLANS } from '@/lib/billing/plans'
import { isCustomPriced } from '@/lib/marketing/pricing'
import { INCLUDED_AI_SUMMARY, TRIAL_CTA_NOTE } from '@/lib/marketing/plan-summary'
import { marketingSiteEnabled } from '@/lib/site'
import { ORGANIZATION_ID, PRODUCT_HEADLINE, PRODUCT_TAGLINE } from '@/lib/site-identity'
import { ArrowRight, MessageCircle, Terminal, Users, GraduationCap, Headphones, Palette, MessagesSquare } from 'lucide-react'

export const dynamic = 'force-dynamic'
const PAGE_TITLE = 'Community support for growing teams | answerLoops'
const PAGE_DESCRIPTION = PRODUCT_TAGLINE
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
    q: 'Who uses answerLoops?',
    a: 'Community managers, course and membership teams, open-source maintainers, and customer support teams use answerLoops to answer recurring questions from their own guides and FAQs.',
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
    description: PAGE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    provider: { '@id': ORGANIZATION_ID },
    // Custom-priced plans have no public price, so they have no offer here.
    offers: ORDERED_PLANS.filter((p) => !isCustomPriced(p.id)).map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: (p.priceMonthly / 100).toString(),
      priceCurrency: 'USD',
      description:
        'Monthly subscription with a 14-day trial. AI usage is included up to a limit; connect your own provider to remove it.',
    })),
  }
  return (
    <MarketingPage chat>
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
              {PRODUCT_HEADLINE}
            </h1>
            <p className="marketing-intro">
              {PRODUCT_TAGLINE}
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
            <h2>Answer visitors right on your website</h2>
            <p className="chat-section-lead">
              Help visitors take the next step without leaving your site. The
              widget uses published articles from the same knowledge base
              that supports your community.
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
            <h2>Give members answers your team can stand behind</h2>
            <p className="chat-section-lead">
              AI drafts replies from your documentation, then a separate AI
              review checks them against their sources. Your team decides
              which channels can send qualifying replies automatically.
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
              <h2>Turn resolved questions into reusable answers</h2>
            </div>
            <p>
              Manage questions from connected channels in one queue. When your
              team resolves a recurring question, save the answer as a
              knowledge base article that answerLoops can draw on for future
              member and customer questions.
            </p>
          </div>
          <FeatureShowcase />
        </div>
      </section>
      <section className="mid-cta" aria-labelledby="mid-cta-title">
        <div className="marketing-container mid-cta-inner">
          <div>
            <h2 id="mid-cta-title">Try answerLoops with real member questions</h2>
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
            <h2>Built for the teams behind communities</h2>
            <p>
              Help new members get started and give people a place to turn
              when they need support.
            </p>
          </div>
          <div className="audience-grid">
            {[
              {
                icon: Users,
                title: 'Community managers',
                body: 'Answer recurring questions about getting started, community rules, and events in the spaces your members already use.',
              },
              {
                icon: GraduationCap,
                title: 'Course and membership teams',
                body: 'Point members to the right lesson, course instructions, or membership information from the materials you already publish.',
              },
              {
                icon: Headphones,
                title: 'Customer support teams',
                body: 'Bring questions from email, chat, and your website into one queue so your team can see what still needs a reply.',
              },
              {
                icon: Terminal,
                title: 'DevRel and open-source teams',
                body: 'Use your quickstarts and troubleshooting guides to answer setup questions in GitHub, Discord, and on your docs site.',
              },
              {
                icon: Palette,
                title: 'Creators and creative communities',
                body: 'Give members answers about submissions, workshop instructions, and participation from the guides you maintain.',
              },
              {
                icon: MessagesSquare,
                title: 'Forum and group moderators',
                body: 'Turn useful resolutions into knowledge you can reuse when the same question comes up in another thread.',
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
              Local or custom models, migration from another support tool, or
              onboarding help for a larger team.
            </p>
          </div>
          <div className="sales-strip-actions">
            <a href={TALK_TO_US_HREF} className="marketing-button">
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
