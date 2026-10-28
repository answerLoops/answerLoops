import { loader } from 'fumadocs-core/source'
import { changelog } from '@/.source/server'

// Loader for the changelog collection, mirroring lib/blog/source.ts. The
// /changelog page lists every entry on one page, so the per-entry urls this
// produces are never routed — they only identify entries.
export const changelogSource = loader({
  baseUrl: '/changelog',
  source: changelog.toFumadocsSource(),
})
