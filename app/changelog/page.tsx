import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MarketingPage, PageHero, TrialCta } from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { formatReleaseDate, getLatestTag, getReleases } from '@/lib/changelog/releases'
import { getMDXComponents } from '@/mdx-components'
import { GITHUB_URL, marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'answerLoops changelog',
  description:
    'Every answerLoops release: new features, fixes, upgrade steps, and configuration changes for people running and building on it.',
  path: '/changelog',
})

// Release notes repeat the same few section names (New, Improved, Fixed, ...)
// in every entry. The compiler gives each heading an anchor id derived from its
// text, which would collide across entries, so headings here render without one.
// The entry itself is addressable by its tag.
const releaseComponents = getMDXComponents({
  h3: ({ children }: React.ComponentProps<'h3'>) => <h3>{children}</h3>,
})

export default function ChangelogPage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  const releases = getReleases()
  const latestTag = getLatestTag(releases)

  return (
    <MarketingPage>
      <PageSchema
        name="answerLoops changelog"
        description="Release notes for every version of answerLoops."
        path="/changelog"
        type="CollectionPage"
      />
      <PageHero eyebrow="Changelog" title="What shipped in each release">
        <p>
          New features, fixes, upgrade steps, and configuration changes, straight from our{' '}
          <a className="underline underline-offset-2" href={`${GITHUB_URL}/releases`}>
            GitHub releases
          </a>
          .
        </p>
      </PageHero>
      <section className="marketing-section">
        <div className="marketing-container marketing-releases">
          {releases.map((release) => {
            const { tag, title, datePublished, url, prerelease } = release.data
            const Notes = release.data.body
            return (
              <article className="marketing-release" id={tag} key={tag}>
                <header className="marketing-release-meta">
                  <h2>
                    <a href={`#${tag}`}>{title}</a>
                  </h2>
                  <time dateTime={datePublished}>{formatReleaseDate(datePublished)}</time>
                  {tag === latestTag && <span className="marketing-release-badge">Latest</span>}
                  {prerelease && (
                    <span className="marketing-release-badge marketing-release-badge-pre">Pre-release</span>
                  )}
                  <a className="marketing-text-link" href={url}>
                    View on GitHub
                  </a>
                </header>
                <div className="marketing-release-body">
                  <Notes components={releaseComponents} />
                </div>
              </article>
            )
          })}
          {releases.length === 0 && <p className="marketing-meta">No releases have been published yet.</p>}
        </div>
      </section>
      <TrialCta />
    </MarketingPage>
  )
}
