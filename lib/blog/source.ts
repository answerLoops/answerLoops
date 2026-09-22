import { loader } from 'fumadocs-core/source'
import { blog } from '@/.source/server'

// Loader for the blog collection, mirroring lib/docs/source.ts. Pages are
// listed and sorted by frontmatter.datePublished in blog/posts.ts rather than
// by a meta.json page-tree order — a blog reads newest-first, not by a
// hand-maintained nav order the way docs groups do.
export const blogSource = loader({
  baseUrl: '/blog',
  source: blog.toFumadocsSource(),
})
