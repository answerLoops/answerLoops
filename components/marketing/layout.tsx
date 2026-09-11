import Link from 'next/link'
import type { ReactNode } from 'react'
import { Nav, Footer, type NavState } from './chrome'
import './marketing.css'

export function MarketingPage({
  children,
  navState,
}: {
  children: ReactNode
  navState?: NavState
}) {
  return (
    <div className="marketing-site">
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav state={navState} />
      <main id="main-content">{children}</main>
      <Footer />
    </div>
  )
}

export function PageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children?: ReactNode
}) {
  return (
    <section className="marketing-hero">
      <div className="marketing-container">
        <p className="marketing-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children && <div className="marketing-intro">{children}</div>}
      </div>
    </section>
  )
}

export function TrialCta({
  title = 'Put your documentation to work.',
  description = 'Connect a support channel, add your knowledge, and review your first answers.',
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
          <Link className="marketing-button" href="/login">
            Start a 14-day trial
          </Link>
          <p className="marketing-note">
            Card required. Cancel before the trial ends to avoid the
            subscription charge.
          </p>
          <Link className="marketing-text-link" href="/pricing">
            View plans and model costs
          </Link>
        </div>
      </div>
    </section>
  )
}
