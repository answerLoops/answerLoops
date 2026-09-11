#!/usr/bin/env node
/**
 * Historical record of the Mintlify -> Fumadocs migration (issue #197).
 * This ran once against the old docs/**\/*.mdx tree to produce
 * content/docs/**\/*.mdx (Fumadocs' live source going forward) plus
 * meta.json nav files reproducing docs/docs.json's group order exactly.
 * It was a mechanical migration, not a content rewrite: prose was copied
 * verbatim, only the handful of Mintlify-only component call sites
 * (CardGroup cols, Tabs/Tab titles) got rewritten to the shape the
 * matching Fumadocs component expects. Everything else
 * (Info/Note/Warning/Tip/Accordion/Accordions/Steps/Step) rendered
 * unchanged because mdx-components.tsx registers Fumadocs components
 * under the same JSX tag names Mintlify used.
 *
 * The old docs/**\/*.mdx source tree was deleted once this ran — edit
 * content/docs/ directly for anything going forward. docs/docs.json is
 * kept only as the legacy-URL manifest next.config.ts's redirects() reads;
 * this script won't run again without restoring the deleted source files.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SRC_ROOT = 'docs'
const DEST_ROOT = 'content/docs'
const NAV = JSON.parse(readFileSync(join(SRC_ROOT, 'docs.json'), 'utf8'))

// Every page id, used to recognize root-relative Mintlify links so they
// can be rewritten to the new /docs-prefixed URL space. Mintlify served
// `introduction.mdx` at `/introduction`; Fumadocs serves it at
// `/docs/introduction`, so every in-repo link needs the prefix or it 404s.
const ALL_PAGE_IDS = new Set(NAV.navigation.groups.flatMap((g) => g.pages))

// The hand-written API reference page is regenerated straight from the live
// OpenAPI spec instead (scripts/generate-api-reference.mts — issue #197
// scope item 5), so it's excluded here and re-slugged to the generated
// folder in the nav. Run `pnpm docs:generate-api` *after* this script; it
// owns `content/docs/reference/api/**` and that folder's meta.json.
const OPENAPI_REPLACED_PAGE_ID = 'reference/api-endpoints'
const SLUG_OVERRIDES = { [OPENAPI_REPLACED_PAGE_ID]: 'api' }

// Self-hosting Stripe setup is internal-ops detail (billing/plan
// enforcement for running this as *our* managed SaaS) — not relevant to
// someone self-hosting their own instance for their own use. Dropped
// entirely from the migrated site, not just reworded. Product-level
// billing docs (product/billing, reference/billing-plans) and the
// integrations/stripe stub are unrelated and still migrate normally.
const DROPPED_PAGE_IDS = new Set(['self-hosting/stripe'])

// --- 1. Rewrite Mintlify-only component call sites that don't map 1:1 ---

function rewriteTabs(mdx) {
  return mdx.replace(/<Tabs>([\s\S]*?)<\/Tabs>/g, (block, inner) => {
    const titles = [...inner.matchAll(/<Tab title="([^"]*)">/g)].map((m) => m[1])
    const strippedInner = inner.replace(/<Tab title="[^"]*">/g, '<Tab>')
    const itemsLiteral = JSON.stringify(titles)
    return `<Tabs items={${itemsLiteral}}>${strippedInner}</Tabs>`
  })
}

function rewriteCardGroup(mdx) {
  // Fumadocs' `Cards` auto-flows into a responsive grid; Mintlify's `cols`
  // prop has no Fumadocs equivalent and isn't a valid DOM attribute, so
  // drop it rather than let it leak onto the rendered <div>.
  return mdx.replace(/<CardGroup(?:\s+cols=\{\d+\})?>/g, '<CardGroup>')
}

function rewriteInternalLinks(mdx) {
  return mdx
    // Markdown links: [text](/page-id) or [text](/page-id#anchor)
    .replace(/(\]\()\/([a-z0-9/_-]+?)(#[a-z0-9-]*)?(\))/gi, (m, open, pageId, anchor = '', close) =>
      ALL_PAGE_IDS.has(pageId) ? `${open}/docs/${pageId}${anchor}${close}` : m
    )
    // JSX href="/page-id" (Card, etc.)
    .replace(/(href=")\/([a-z0-9/_-]+?)(#[a-z0-9-]*)?(")/gi, (m, open, pageId, anchor = '', close) =>
      ALL_PAGE_IDS.has(pageId) ? `${open}/docs/${pageId}${anchor}${close}` : m
    )
}

function rewriteCodeFenceLangs(mdx) {
  // Mintlify's syntax highlighter accepted `env` as a code fence language;
  // Shiki (which Fumadocs uses) doesn't ship that grammar name — the
  // closest match it does ship is `dotenv`.
  return mdx.replace(/^```env$/gm, '```dotenv')
}

// Per-page content redactions for the self-hosting Stripe drop (see
// DROPPED_PAGE_IDS comment above) — these three pages keep everything
// else, only the Stripe-specific parts are removed.
const CONTENT_REDACTIONS = {
  'self-hosting/environment-variables': (mdx) =>
    mdx.replace(/\n## Stripe billing \(optional\)\n[\s\S]*?\n(?=## )/, '\n'),
  'self-hosting/prerequisites': (mdx) =>
    mdx.replace(/\n\| Stripe \| Billing \/ plan enforcement[^\n]*\|\n/, '\n'),
  'self-hosting/production': (mdx) =>
    mdx.replace(/\n- \[ \] Stripe webhook URL updated to production domain\n/, '\n'),
}

function transform(mdx, pageId) {
  let out = rewriteInternalLinks(rewriteCardGroup(rewriteTabs(rewriteCodeFenceLangs(mdx))))
  if (CONTENT_REDACTIONS[pageId]) out = CONTENT_REDACTIONS[pageId](out)
  return out
}

// --- 2. Copy + transform every page referenced in docs.json's nav tree ---

function migratePage(pageId) {
  const srcPath = join(SRC_ROOT, `${pageId}.mdx`)
  const destPath = join(DEST_ROOT, `${pageId}.mdx`)
  const raw = readFileSync(srcPath, 'utf8')
  const migrated = transform(raw, pageId)
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, migrated)
}

// --- 3. meta.json per group, in docs.json's exact order ---

function slugFor(pageId) {
  if (pageId in SLUG_OVERRIDES) return SLUG_OVERRIDES[pageId]
  const parts = pageId.split('/')
  return parts[parts.length - 1]
}

function writeRootMeta(groups) {
  // Root meta.json orders the top-level nav: standalone "Getting Started"
  // pages first (as individual entries, matching Mintlify's ungrouped
  // top-level group), then each subsequent group as a named folder.
  const pages = []
  for (const group of groups) {
    const allTopLevel = group.pages.every((p) => !p.includes('/'))
    if (group.group === 'Getting Started' && allTopLevel) {
      for (const p of group.pages) pages.push(slugFor(p))
    } else {
      const folder = group.pages[0].split('/')[0]
      pages.push(`${folder}`)
    }
  }
  writeFileSync(
    join(DEST_ROOT, 'meta.json'),
    JSON.stringify({ title: 'answerLoops Docs', pages }, null, 2) + '\n'
  )
}

function writeGroupMeta(group) {
  const folder = group.pages[0].split('/')[0]
  const pages = group.pages.filter((p) => !DROPPED_PAGE_IDS.has(p)).map(slugFor)
  writeFileSync(
    join(DEST_ROOT, folder, 'meta.json'),
    JSON.stringify({ title: group.group, pages }, null, 2) + '\n'
  )
}

// --- run ---

if (existsSync(DEST_ROOT)) rmSync(DEST_ROOT, { recursive: true })
mkdirSync(DEST_ROOT, { recursive: true })

const groups = NAV.navigation.groups
for (const group of groups) {
  for (const pageId of group.pages) {
    if (pageId === OPENAPI_REPLACED_PAGE_ID) continue
    if (DROPPED_PAGE_IDS.has(pageId)) continue
    migratePage(pageId)
  }
  const allTopLevel = group.pages.every((p) => !p.includes('/'))
  if (!(group.group === 'Getting Started' && allTopLevel)) {
    writeGroupMeta(group)
  }
}
writeRootMeta(groups)

const migratedCount = groups
  .flatMap((g) => g.pages)
  .filter((p) => p !== OPENAPI_REPLACED_PAGE_ID && !DROPPED_PAGE_IDS.has(p)).length
console.log(`Migrated ${migratedCount} pages into ${DEST_ROOT}/`)
