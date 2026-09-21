import type { Metadata } from 'next'

/** Use each page's topic for search results and shared links. */
export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
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
