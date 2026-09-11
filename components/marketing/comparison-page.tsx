/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Horizontal scroll regions need keyboard focus so arrow keys can reveal every column. */
import Link from 'next/link'
import { MarketingPage, PageHero, TrialCta } from './layout'
import { PageSchema } from './page-schema'
export interface ComparisonRow {
  feature: string
  us: string
  them: string
}
export interface ComparisonPageProps {
  competitor: string
  competitorSummary: string
  intro: string
  rows: ComparisonRow[]
  bestFor: { us: string; them: string }
  slug?: string
  source: string
}
export function ComparisonPage({
  competitor,
  competitorSummary,
  intro,
  rows,
  bestFor,
  slug: providedSlug,
  source,
}: ComparisonPageProps) {
  const slug = providedSlug ?? competitor.toLowerCase()
  return (
    <MarketingPage>
      <PageSchema
        name={`AnswerLoops vs ${competitor}`}
        description={intro}
        path={`/vs/${slug}`}
        breadcrumbs={[{ name: 'Comparisons', path: '/alternatives' }]}
      />
      <PageHero
        eyebrow="Product comparison"
        title={`AnswerLoops vs ${competitor}`}
      >
        <p>{intro}</p>
      </PageHero>
      <section className="marketing-section">
        <div className="marketing-container">
          <p className="max-w-3xl">{competitorSummary}</p>
          <p className="marketing-meta">
            Reviewed September 11, 2026 against{' '}
            <a className="marketing-text-link" href={source}>
              {competitor}’s published product information
            </a>
            . This comparison covers selected capabilities; check plan
            availability with each provider.
          </p>
          <p className="marketing-meta md:hidden">
            Scroll the table horizontally to compare both products.
          </p>
          <div
            className="overflow-x-auto"
            role="region"
            aria-label={`${competitor} comparison`}
            tabIndex={0}
          >
            <table className="marketing-table">
              <caption className="sr-only">
                AnswerLoops and {competitor}: selected capabilities
              </caption>
              <thead>
                <tr>
                  <th scope="col">Consideration</th>
                  <th scope="col">AnswerLoops</th>
                  <th scope="col">{competitor}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    <td>{row.us}</td>
                    <td>{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="marketing-grid mt-10">
            <article className="marketing-card">
              <h2 className="!text-xl">Consider AnswerLoops when</h2>
              <p>{bestFor.us}</p>
            </article>
            <article className="marketing-card">
              <h2 className="!text-xl">Consider {competitor} when</h2>
              <p>{bestFor.them}</p>
            </article>
          </div>
          <p className="mt-8">
            For AnswerLoops, compare the{' '}
            <Link className="marketing-text-link" href="/pricing">
              hosted plan limits and model costs
            </Link>
            , or review the{' '}
            <Link className="marketing-text-link" href="/self-hosting-proof">
              self-hosting requirements
            </Link>
            .
          </p>
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
