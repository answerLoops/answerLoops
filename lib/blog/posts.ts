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
 * Posts related to the given one, for the "Related articles" block at the
 * bottom of each post. Ranked by shared `tags` count (richer signal than
 * `category` alone — two posts can share a category but cover unrelated
 * ground). Falls back to same-category posts when a post has no tag overlap
 * with anything else, so older or sparsely-tagged posts still get a related
 * link instead of an empty section. Ties broken by recency.
 */
export function getRelatedPosts(slug: string, limit = 3) {
  const current = getBlogPost(slug)
  if (!current) return []

  const currentTags = new Set(current.data.tags ?? [])
  const candidates = getBlogPosts().filter((post) => post.slugs[0] !== slug)

  const scored = candidates
    .map((post) => {
      const sharedTags = (post.data.tags ?? []).filter((tag) => currentTags.has(tag)).length
      const sameCategory = post.data.category === current.data.category ? 1 : 0
      return { post, sharedTags, sameCategory }
    })
    .filter(({ sharedTags, sameCategory }) => sharedTags > 0 || sameCategory > 0)
    .sort((a, b) => {
      if (b.sharedTags !== a.sharedTags) return b.sharedTags - a.sharedTags
      if (b.sameCategory !== a.sameCategory) return b.sameCategory - a.sameCategory
      return b.post.data.datePublished.localeCompare(a.post.data.datePublished)
    })

  return scored.slice(0, limit).map(({ post }) => post)
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
