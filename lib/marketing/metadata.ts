import type { Metadata } from 'next'

/** Use each page's topic for search results and shared links. */
export function publicPageMetadata({
  title,
  description,
  path,
  canonicalUrl,
}: {
  title: string
  description: string
  path: string
  /**
   * Overrides the default self-canonical (`path`) when this content's
   * canonical version lives elsewhere — a post syndicated from (or to)
   * another site, or two of our own posts covering the same ground where
   * one should defer to the other. Absolute URL. Google treats a page
   * without a matching canonical as a duplicate-content signal, which can
   * suppress it from search entirely, so this is opt-in per page rather
   * than a blanket default.
   */
  canonicalUrl?: string
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl ?? path },
    openGraph: {
      type: 'website',
      siteName: 'answerLoops',
      title,
      description,
      url: path,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}
