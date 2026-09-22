import { blogSource } from './source'

/**
 * All published posts (drafts excluded), newest first. The blog has no
 * hand-maintained nav order the way docs groups do — sorting by
 * datePublished is the only ordering that makes sense for a blog index.
 */
export function getBlogPosts() {
  return blogSource
    .getPages()
    .filter((page) => !page.data.draft)
    .sort((a, b) => b.data.datePublished.localeCompare(a.data.datePublished))
}

export function getBlogPost(slug: string) {
  const page = blogSource.getPage([slug])
  if (!page || page.data.draft) return undefined
  return page
}

/**
 * Formats a plain `YYYY-MM-DD` publish date without shifting it a day in a
 * timezone behind UTC — `new Date('2026-09-10')` parses as UTC midnight, and
 * formatting that in the visitor's local zone (anything west of UTC) renders
 * "September 9". Pinning the format call to UTC keeps the date the one in
 * the post's frontmatter, everywhere, regardless of the reader's timezone.
 */
export function formatPostDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
