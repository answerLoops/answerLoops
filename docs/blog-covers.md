# Blog cover art (maintainer notes)

This used to live in the public docs. It is for people who maintain the answerLoops blog, so it now lives in the repository instead.

Every blog post can have its own cover illustration. This note explains where that artwork shows up, how a post picks its cover, and how to add a new one.

## Where the cover appears

Covers use a consistent **1200 × 630** frame and appear in three places:

- **Blog index card:** the artwork sits above the author, publication date, title and description.
- **Article page:** a selected cover also appears above the article body.
- **Shared links:** the same image is used for the Open Graph preview.

The article's publication date is displayed without shifting across time zones.

## Choose a cover for a post

1. Set `coverImage` in the post's frontmatter to select its cover.
2. Add `coverImageAlt` to describe the illustration for readers using assistive technology.

Posts without a selected cover keep their generated title-and-category image on the index and in Open Graph previews. Existing integration marks stay intact.

## Current covers

Each article's cover is served from `/blog/<slug>/opengraph-image`, so its index card, article and Open Graph preview all use the same artwork.

| Article slug | Illustration | Color balance |
|---|---|---|
| `dual-agent-review` | The draft and review steps | Aqua-to-sand gradient |
| `mcp-server-for-support` | An agent connected to knowledge, tickets and answers | Teal glow at the upper left fading to warm sand at the lower right |
| `circle-community-support` | A centered headline and overlapping conversation bubbles: a member's question and a reply grounded in the community's knowledge base | Warm sand at the top fading into a teal glow beneath |
| `discord-community-support` | A channel with the question and reply together, plus a floating thread label | Cool blue-teal gradient on the right, small sand glow at the lower left |
| `discourse-forum-support` | Layered knowledge cards behind a new forum topic | Light lavender glow alongside aqua, sand and navy |
| `email-support-automation` | A navy envelope leading to a prepared reply in the same conversation | Lavender at the lower left and aqua at the upper right around a warm, open center |
| `github-open-source-support` | A repository README behind a community question answered from the docs | Lavender at the upper left fading toward aqua on the right and sand below |
| `google-chat-internal-support` | A team help space answering an onboarding question from the team knowledge base | Aqua above and lavender below |
| `notion-knowledge-base-sync` | A shared guide passing through a published step before becoming a support answer | Lavender on the left, warm center, aqua on the right |
| `slack-no-admin-approval` | A channel question connected to a reply from the team knowledge base | Warm sand at the lower left balancing lavender at the upper right |
| `telegram-community-support` | A paper plane on a curved path above a group question and a knowledge-backed reply | Blue-aqua glow below and light lavender above |
| `managing-every-community-platform-from-one-place` | Four channel cards connected to a shared inbox backed by one knowledge base | Warm top, aqua glow below, lavender corner |
| `turn-support-answers-into-reusable-knowledge` | A support reply moving into a saved knowledge-base article, which a search then finds | Lavender at the upper left, aqua on the right, sand below |

## Add or change a cover

The shared React frame in `lib/blog/cover-art.tsx` defines the canvas, palette, brand mark and footer. Each illustration supplies its own composition inside that frame. The image renderer in `app/blog/[slug]/opengraph-image.tsx` selects the artwork for the post.

1. Build the illustration inside the shared frame, using the public site's navy, teal, aqua and sand palette.
2. Keep the composition simple enough to recognize in a small card, and vary gradient direction, focal placement and color balance instead of repeating one background.
3. Check the full-size image and the blog at a 375px viewport.

> Cover illustrations are introduced one article at a time. Adding one doesn't change other posts' art.

