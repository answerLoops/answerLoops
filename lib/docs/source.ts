import { loader } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/plugins/lucide-icons'
import { docs } from '@/.source/server'

// Single loader for the whole docs/ tree, replacing Mintlify's docs.json
// nav resolution. Page tree ordering comes from meta.json files under
// content/docs/**, mirroring the group order in the old docs.json exactly.
export const docsSource = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  // `icon: <LucideName>` in a page's frontmatter or a folder's meta.json
  // renders that lucide icon next to the entry in the sidebar.
  plugins: [lucideIconsPlugin()],
})
