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
    title: 'Managing every community platform from one place',
    description:
      'Discord, Slack, a forum, GitHub, email, a chat widget — the same questions land in all of them. How AnswerLoops turns that into one pipeline instead of five separate jobs.',
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
  return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
