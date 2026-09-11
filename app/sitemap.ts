import type { MetadataRoute } from 'next'
import { docsSource } from '@/lib/docs/source'

const BASE_URL = 'https://answerloops.com'

// Captured once when this module is first loaded — i.e. per deploy, not per
// request. `new Date()` inline meant every crawl saw a lastmod of "right now",
// which trains crawlers to ignore the field entirely. A timestamp that only
// moves when a new build ships is both honest (the content really can change
// on deploy) and useful as a change signal.
const DEPLOY_TIME = new Date()

type ChangeFrequency = MetadataRoute.Sitemap[number]['changeFrequency']

// Static marketing routes worth a crawler's time. Auth-gated app routes
// (/dashboard, /settings, etc.) are intentionally excluded — a crawler can't
// do anything useful with a page that just redirects to /login.
// Order is kept stable because scripts/sync-llms-txt.mjs derives the llms.txt
// "Links" block from this list. priority is relative within this site only.
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: ChangeFrequency }[] = [
  { path: '', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/agentic-support', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/blog', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/blog/managing-every-community-platform-from-one-place', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/architecture', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/discord-github-support', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/mcp-support-agents', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/open-source-support', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/alternatives', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/self-hosted-ai-support', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/self-hosting-proof', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/support-example', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/support-workflow', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/vs/chatbase', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/vs/intercom', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/vs/plain', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/vs/pylon', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/vs/zendesk-ai', priority: 0.8, changeFrequency: 'monthly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: DEPLOY_TIME,
    changeFrequency,
    priority,
  }))

  const docsEntries: MetadataRoute.Sitemap = docsSource.getPages().map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: DEPLOY_TIME,
    changeFrequency: 'monthly' as ChangeFrequency,
    priority: 0.5,
  }))

  return [...staticEntries, ...docsEntries]
}
