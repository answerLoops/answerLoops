import Link from 'next/link'
import type { ReactNode } from 'react'
import type { NavState } from './chrome'
import { PageSchema, type PageSchemaProps } from './page-schema'
import { MarketingPage, PageHero, TrialCta } from './layout'
export interface ProofPageProps {
  navState: NavState
  eyebrow: string
  title: string
  intro: string
  sections: Array<{ title: string; body: string; details: string[] }>
  docs: Array<{ label: string; href: string }>
  schema: PageSchemaProps
  children?: ReactNode
}
export function ProofPage({
  navState,
  eyebrow,
  title,
  intro,
  sections,
  docs,
  schema,
  children,
}: ProofPageProps) {
  return (
    <MarketingPage navState={navState}>
      <PageSchema {...schema} />
      <PageHero eyebrow={eyebrow} title={title}>
        <p>{intro}</p>
      </PageHero>
      {children}
      <section className="marketing-section">
        <div className="marketing-container marketing-grid">
          {sections.map((section) => (
            <article key={section.title} className="marketing-card">
              <h2 className="!text-xl">{section.title}</h2>
              <p>{section.body}</p>
              <ul>
                {section.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section marketing-soft">
        <div className="marketing-container">
          <h2>Continue in the documentation</h2>
          <div className="marketing-actions">
            {docs.map((d) => (
              <Link
                key={d.href}
                className="marketing-button marketing-button-secondary"
                href={d.href}
              >
                {d.label}
              </Link>
            ))}
          </div>
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
