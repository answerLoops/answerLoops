import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Source_Sans_3 } from 'next/font/google'
import { START_HREF, PRICING_HREF } from './nav-shared'
import { TRIAL_CTA_NOTE } from '@/lib/marketing/plan-summary'
import type { ReactNode } from 'react'
import { Nav, Footer, type NavState } from './chrome'
import { SiteChatWidget } from '@/components/site-chat-widget'
import './marketing-site.css'
import './marketing-theme.css'

const marketingFont = Source_Sans_3({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-marketing-sans',
})

export function MarketingPage({
  children,
  navState,
  chat = false,
}: {
  children: ReactNode
  navState?: NavState
  /**
   * Show the chat assistant on this page. Off by default so each page that
   * carries it is a decision: it belongs where a visitor is deciding whether
   * answerLoops is right for them, not on a legal page or a changelog.
   */
  chat?: boolean
}) {
  return (
    <div className={`marketing-site ${marketingFont.variable}`}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav state={navState} />
      <main id="main-content">{children}</main>
      <Footer />
      {chat && <SiteChatWidget />}
    </div>
  )
}

export function PageHero({
  eyebrow,
  title,
  children,
  aside,
  compact = false,
}: {
  eyebrow?: string
  title: string
  children?: ReactNode
  aside?: ReactNode
  /** A shorter hero, for pages whose main content should show without scrolling. */
  compact?: boolean
}) {
  return (
    <section className={`marketing-hero${compact ? ' marketing-hero-compact' : ''}`}>
      <div
        className={`marketing-container${aside ? ' marketing-hero-split' : ''}`}
      >
        <div className="marketing-hero-copy">
          {eyebrow && <p className="marketing-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {children && <div className="marketing-intro">{children}</div>}
        </div>
        {aside}
      </div>
    </section>
  )
}

export function TrialCta({
  title = 'Start with the questions people already ask',
  description = 'Connect a community channel or add website chat. See how both can use the guides you already maintain.',
}: {
  title?: string
  description?: string
}) {
  return (
    <section className="marketing-cta">
      <div className="marketing-container">
        <div>
          <p className="marketing-eyebrow">Get started</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div>
          <Link className="marketing-button marketing-button-hero" href={START_HREF}>
            Start your free trial
            <ArrowRight size={18} strokeWidth={2.25} aria-hidden="true" />
          </Link>
          <p className="marketing-note">
            {TRIAL_CTA_NOTE}
          </p>
          <Link className="marketing-text-link" href={PRICING_HREF}>
            View plans and model costs
          </Link>
        </div>
      </div>
    </section>
  )
}
