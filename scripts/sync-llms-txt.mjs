import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LLMS_PATH = path.join(ROOT, 'public/llms.txt')
const SITEMAP_PATH = path.join(ROOT, 'app/sitemap.ts')
const INTEGRATIONS_PATH = path.join(ROOT, 'content/docs/integrations/meta.json')
const BASE_URL = 'https://answerloops.com'

const LINKS_START = '<!-- BEGIN GENERATED PUBLIC LINKS -->'
const LINKS_END = '<!-- END GENERATED PUBLIC LINKS -->'
const INTEGRATIONS_START = '<!-- BEGIN GENERATED INTEGRATION LINKS -->'
const INTEGRATIONS_END = '<!-- END GENERATED INTEGRATION LINKS -->'

const LABELS = {
  '': 'Marketing site',
  '/agentic-support': 'Agentic support overview',
  '/pricing': 'Pricing',
  '/alternatives': 'Alternatives & comparisons',
  '/about': 'About',
  '/blog': 'Blog',
  '/blog/managing-every-community-platform-from-one-place': 'Blog: Managing every community platform from one place',
  '/privacy': 'Privacy policy',
  '/terms': 'Terms of service',
  '/vs/chatbase': 'AnswerLoops vs Chatbase',
  '/vs/intercom': 'AnswerLoops vs Intercom',
  '/vs/plain': 'AnswerLoops vs Plain',
  '/vs/pylon': 'AnswerLoops vs Pylon',
  '/vs/zendesk-ai': 'AnswerLoops vs Zendesk AI',
}

// The order llms.txt should present integrations in: first-class community
// channels first, then the also-supported Google Chat, then the agent surfaces.
// The AI-provider pages in content/docs/integrations/meta.json (openai,
// anthropic, …) and Stripe are intentionally omitted — they are configuration,
// not channels a crawler would connect.
const INTEGRATION_ORDER = [
  'discord',
  'slack',
  'discourse',
  'circle',
  'telegram',
  'email',
  'github',
  'google-chat',
  'mcp',
  'agent-api',
]

const INTEGRATION_LABELS = {
  discord: 'Discord',
  slack: 'Slack',
  discourse: 'Discourse',
  circle: 'Circle',
  telegram: 'Telegram',
  email: 'Email',
  github: 'GitHub',
  'google-chat': 'Google Chat',
  mcp: 'MCP server',
  'agent-api': 'Agent API (REST)',
}

function extractStaticRoutes(sitemapSource) {
  const match = sitemapSource.match(/const STATIC_ROUTES[^=]*=\s*\[([\s\S]*?)\n\]/)
  if (!match) throw new Error('Could not find STATIC_ROUTES in app/sitemap.ts')
  const block = match[1]
  // Current shape is an array of `{ path: '...', priority, changeFrequency }`
  // objects; fall back to the older bare-string-array shape.
  const pathEntries = [...block.matchAll(/path:\s*'([^']*)'/g)].map(([, route]) => route)
  if (pathEntries.length > 0) return pathEntries
  return [...block.matchAll(/'([^']*)'/g)].map(([, route]) => route)
}

function generatedBlock(source, start, end, lines) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`Missing generated block markers: ${start}`)
  }
  const contentStart = startIndex + start.length
  return source.slice(0, contentStart) + `\n${lines.join('\n')}\n` + source.slice(endIndex)
}

export function syncLlmsText(llmsText, sitemapSource, integrationsJson) {
  const routes = extractStaticRoutes(sitemapSource)
  const publicLinks = routes.map((route) => `- ${LABELS[route] ?? route}: ${BASE_URL}${route}`)
  const available = new Set(integrationsJson.pages)
  const integrations = INTEGRATION_ORDER
    .filter((slug) => available.has(slug) && slug in INTEGRATION_LABELS)
    .map((slug) => `- ${INTEGRATION_LABELS[slug]}: ${BASE_URL}/docs/integrations/${slug}`)

  let result = generatedBlock(llmsText, LINKS_START, LINKS_END, publicLinks)
  result = generatedBlock(result, INTEGRATIONS_START, INTEGRATIONS_END, integrations)
  return result
}

async function main() {
  const [llmsText, sitemapSource, integrationsText] = await Promise.all([
    readFile(LLMS_PATH, 'utf8'),
    readFile(SITEMAP_PATH, 'utf8'),
    readFile(INTEGRATIONS_PATH, 'utf8'),
  ])
  const next = syncLlmsText(llmsText, sitemapSource, JSON.parse(integrationsText))

  if (process.argv.includes('--check')) {
    if (next !== llmsText) {
      console.error('public/llms.txt is stale. Run `pnpm llms:sync` and commit the result.')
      process.exitCode = 1
    }
    return
  }

  if (next !== llmsText) await writeFile(LLMS_PATH, next)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
