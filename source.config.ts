import { defineDocs, defineConfig } from 'fumadocs-mdx/config'
import { pageSchema } from 'fumadocs-core/source/schema'
import { z } from 'zod'

// Single collection backing the whole docs/ tree — mirrors the old
// docs/docs.json nav (one flat page collection + meta.json per folder
// for group ordering, same shape Mintlify used).
export const docs = defineDocs({
  dir: 'content/docs',
})

// SEO/marketing blog. Flat under content/blog/ — every post, whatever its
// topic (thought leadership, an integration writeup, a comparison), gets a
// URL directly under /blog/<slug> rather than a topic-prefixed path, and
// `category` groups posts on the index page instead of the URL. Rendered
// through the marketing site's own layout (MarketingPage/PageHero), not
// fumadocs-ui's docs shell — see app/blog/[slug]/page.tsx.
export const blog = defineDocs({
  dir: 'content/blog',
  docs: {
    schema: pageSchema.extend({
      // pageSchema leaves `description` optional (fine for a docs page); a
      // blog post always needs one for its meta tag and JSON-LD.
      description: z.string(),
      // Sub-title shown under the H1, distinct from `description` (meta tag).
      subtitle: z.string(),
      // A short, direct-answer paragraph rendered in its own box right after
      // the header — written to be liftable by Google's featured snippets /
      // AI Overviews, not just the human-readable lede.
      overview: z.string(),
      author: z.string(),
      // ISO date strings, not z.date() — MDX frontmatter is YAML text, and a
      // bare `2026-09-10` parses as UTC midnight; keeping it a string and
      // formatting explicitly (see lib/blog/format.ts) avoids the timezone
      // shift a Date round-trip would introduce.
      datePublished: z.string(),
      dateModified: z.string().optional(),
      // Free string, not a hardcoded enum: a new content category (a new
      // integration, a new comparison target) should never need a code
      // change here, only a new post.
      category: z.string(),
      // Optional: supply a real image, or omit it and let
      // app/blog/[slug]/opengraph-image.tsx generate one from title+category.
      coverImage: z.string().optional(),
      coverImageAlt: z.string().optional(),
      // Absolute URL. Set only when this post's canonical version lives
      // elsewhere — content syndicated from (or to) another site, or a
      // near-duplicate of another post of ours that should defer to it.
      // Omitted, a post canonicalizes to itself (the default every other
      // page on the site gets from publicPageMetadata).
      canonicalUrl: z.string().url().optional(),
      draft: z.boolean().optional(),
    }),
  },
})

export default defineConfig({
  mdxOptions: {
    // Mintlify's `<Note>` etc. compiled fine without extra remark/rehype
    // plugins; the Fumadocs equivalents (Callout, Cards, Tabs, Steps) are
    // plain React components registered in mdx-components.tsx, so no extra
    // MDX processing config is required beyond the defaults.
  },
})
