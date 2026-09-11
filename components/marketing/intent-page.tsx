import Link from 'next/link'
import type { NavState } from './chrome'
import { PageSchema, type PageSchemaProps } from './page-schema'
import { MarketingPage, PageHero, TrialCta } from './layout'
export interface IntentPageProps {
  navState: NavState
  eyebrow: string
  title: string
  intro: string
  audience: string
  highlights: Array<{ title: string; body: string }>
  workflow: Array<{ step: string; title: string; body: string }>
  comparison: Array<{ question: string; answer: string }>
  docs: Array<{ label: string; href: string }>
  schema: PageSchemaProps
}
export function IntentPage({
  navState,
  eyebrow,
  title,
  intro,
  audience,
  highlights,
  workflow,
  comparison,
  docs,
  schema,
}: IntentPageProps) {
  return (
    <MarketingPage navState={navState}>
      <PageSchema {...schema} />
      <PageHero eyebrow={eyebrow} title={title}>
        <p>{intro}</p>
        <div className="marketing-actions">
          {docs.slice(0, 2).map((doc) => (
            <Link
              key={doc.href}
              className="marketing-button marketing-button-secondary"
              href={doc.href}
            >
              {doc.label}
            </Link>
          ))}
        </div>
      </PageHero>
      <section className="marketing-section">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <h2>Who uses this</h2>
            <p>{audience}</p>
          </div>
          <div className="marketing-grid">
            {highlights.map((h) => (
              <article className="marketing-card" key={h.title}>
                <h3>{h.title}</h3>
                <p>{h.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section marketing-soft">
        <div className="marketing-container">
          <h2>Set up your workflow</h2>
          <ol className="marketing-workflow">
            {workflow.map((w) => (
              <li className="marketing-workflow-step" key={w.step}>
                <p className="marketing-eyebrow">{w.step}</p>
                <h3>{w.title}</h3>
                <p>{w.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container marketing-reading">
          <h2>Setup questions</h2>
          <div className="marketing-faq">
            {comparison.map((c) => (
              <details key={c.question}>
                <summary>{c.question}</summary>
                <p>{c.answer}</p>
              </details>
            ))}
          </div>
          <div className="marketing-actions">
            {docs.map((d) => (
              <Link key={d.href} className="marketing-text-link" href={d.href}>
                {d.label} →
              </Link>
            ))}
          </div>
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
