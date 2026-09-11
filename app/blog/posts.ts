// Single source of truth for the blog index and each post's metadata, so the
// index page and a post's own <head> tags can never drift from each other.
export interface BlogPost {
  slug: string
  title: string
  description: string
  datePublished: string // ISO date
  author: string
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'managing-every-community-platform-from-one-place',
    title: 'Managing support across community platforms',
    description:
      'How a shared ticket queue and maintained knowledge base help a team answer questions across its community channels.',
    datePublished: '2026-09-10',
    author: 'Nathan Tarbert',
  },
]

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug)
}

/**
 * Formats a plain `YYYY-MM-DD` publish date without shifting it a day in a
 * timezone behind UTC — `new Date('2026-09-10')` parses as UTC midnight, and
 * formatting that in the visitor's local zone (anything west of UTC) renders
 * "September 9". Pinning the format call to UTC keeps the date the one in
 * BLOG_POSTS, everywhere, regardless of the reader's timezone.
 */
export function formatPostDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
