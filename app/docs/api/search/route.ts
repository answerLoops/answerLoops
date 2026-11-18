import { createFromSource } from 'fumadocs-core/search/server'
import { docsSource } from '@/lib/docs/source'
import { buildDocsSearchIndex } from '@/lib/docs/search-index'

// Local in-memory Orama index built from the same page tree the sidebar
// uses — replaces Mintlify's built-in hosted search (issue #197). No
// external search service: the index is built once per server instance
// from `docsSource`, same as every other fumadocs-mdx deployment.
//
// Each page's text goes through buildDocsSearchIndex first, so results read as
// plain sentences rather than component props or markdown table rows.
export const { GET } = createFromSource(docsSource, {
  buildIndex: buildDocsSearchIndex,
})
