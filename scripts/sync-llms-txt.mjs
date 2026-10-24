import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LLMS_PATH = path.join(ROOT, 'public/llms.txt')
const SITEMAP_PATH = path.join(ROOT, 'app/sitemap.ts')
const INTEGRATIONS_PATH = path.join(ROOT, 'content/docs/integrations/meta.json')
const PLANS_PATH = path.join(ROOT, 'lib/billing/plans.ts')
const INTRODUCTION_PATH = path.join(ROOT, 'content/docs/introduction.mdx')
const DOCS_DIR = path.join(ROOT, 'content/docs')
const APP_DIR = path.join(ROOT, 'app')
const PUBLIC_DIR = path.join(ROOT, 'public')
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
  '/privacy': 'Privacy policy',
  '/terms': 'Terms of service',
  '/vs/bettermode': 'answerLoops vs Bettermode',
  '/vs/chatbase': 'answerLoops vs Chatbase',
  '/vs/intercom': 'answerLoops vs Intercom Fin',
  '/vs/kapa-ai': 'answerLoops vs Kapa.ai',
  '/vs/khoros-aurora-ai': 'answerLoops vs Khoros Aurora AI',
  '/vs/plain': 'answerLoops vs Plain',
  '/vs/pylon': 'answerLoops vs Pylon',
  '/vs/zendesk-ai': 'answerLoops vs Zendesk AI',
}

// The order llms.txt should present integrations in: first-class community
// channels first, then the agent surfaces.
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

// Pages in content/docs/integrations/meta.json that are deliberately not in the
// llms.txt integration list: configuration references and the Notion knowledge
// source, none of which is a channel that sends questions in. Every other page
// must be in INTEGRATION_ORDER, so adding an integration page forces a decision
// here instead of silently leaving llms.txt behind.
const NON_CHANNEL_INTEGRATION_PAGES = [
  'notion',
  'agent-skills',
  'openai',
  'anthropic',
  'google-gemini',
  'groq',
  'mistral',
  'ollama',
  'stripe',
]

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

// ---------------------------------------------------------------------------
// Fact checks. The generated blocks above are rewritten by `pnpm llms:sync`.
// Everything below only verifies: it compares what the hand-written sections of
// llms.txt claim against the code and docs they describe, and reports each
// mismatch. It never edits the file, because correcting prose is a judgement
// call that belongs to the /project:update-llms-txt skill and the PR author.
// ---------------------------------------------------------------------------

function section(llmsText, heading) {
  const match = llmsText.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  return match ? match[1] : ''
}

function planBlock(plansSource, id) {
  const match = plansSource.match(new RegExp(`\\n  ${id}: \\{([\\s\\S]*?)\\n  \\},`))
  if (!match) throw new Error(`Could not find the ${id} plan in lib/billing/plans.ts`)
  return match[1]
}

/** Reads the plan facts llms.txt repeats out of lib/billing/plans.ts. */
export function extractPlanFacts(plansSource) {
  const trialDays = Number(plansSource.match(/export const TRIAL_DAYS = (\d+)/)?.[1])
  const discountPct = Number(plansSource.match(/export const ANNUAL_DISCOUNT_PCT = (\d+)/)?.[1])
  if (!trialDays || !discountPct) throw new Error('Could not read TRIAL_DAYS / ANNUAL_DISCOUNT_PCT')
  const plans = {}
  for (const id of ['standard', 'pro', 'enterprise']) {
    const block = planBlock(plansSource, id)
    const name = block.match(/name: '([^']+)'/)?.[1]
    const cents = Number(block.match(/priceMonthly: (\d+)/)?.[1])
    const quotaRaw = block.match(/deflectionsPerMonth: (\d+|null)/)?.[1]
    const overageRaw = block.match(/overageRatePer100Cents: (\d+|null)/)?.[1]
    if (!name || !cents || !quotaRaw || !overageRaw) throw new Error(`Could not read the ${id} plan`)
    // Mirrors annualMonthlyPrice(): whole dollars, rounded down.
    const monthlyEquivalent = Math.floor((cents * (1 - discountPct / 100)) / 100)
    plans[id] = {
      name,
      monthly: cents / 100,
      quota: quotaRaw === 'null' ? null : Number(quotaRaw),
      overage: overageRaw === 'null' ? null : Number(overageRaw) / 100,
      annualEquivalent: monthlyEquivalent,
      annualTotal: monthlyEquivalent * 12,
    }
  }
  return { trialDays, plans }
}

const usd = (n) => `$${n.toLocaleString('en-US')}`

export function checkPricing(llmsText, plansSource) {
  const text = section(llmsText, 'Pricing')
  if (!text) return ['llms.txt has no "## Pricing" section']
  const { trialDays, plans } = extractPlanFacts(plansSource)
  const errors = []
  const allowedAmounts = new Set()
  const expectIn = (needle, why) => {
    if (!text.includes(needle)) errors.push(`Pricing: expected "${needle}" (${why})`)
  }

  for (const plan of Object.values(plans)) {
    expectIn(`${plan.name} ${usd(plan.monthly)}`, `${plan.name} monthly price`)
    expectIn(`${plan.name} ${usd(plan.annualTotal)}`, `${plan.name} annual total`)
    expectIn(`(${usd(plan.annualEquivalent)} `, `${plan.name} monthly equivalent on annual billing`)
    allowedAmounts.add(usd(plan.monthly))
    allowedAmounts.add(usd(plan.annualTotal))
    allowedAmounts.add(usd(plan.annualEquivalent))
    if (plan.quota === null) {
      expectIn(`${plan.name} ${usd(plan.monthly)} with unlimited`, `${plan.name} has no answer cap`)
    } else {
      expectIn(`${plan.name} ${usd(plan.monthly)} with ${plan.quota.toLocaleString('en-US')}`, `${plan.name} included answers`)
    }
    if (plan.overage !== null) {
      expectIn(`${usd(plan.overage)} per additional block of 100`, `${plan.name} overage rate`)
      allowedAmounts.add(usd(plan.overage))
    }
  }
  expectIn(`${trialDays}-day trial`, 'TRIAL_DAYS')

  // A price that is no longer in the plan table is stale even if every current
  // price is also present, e.g. an old tier left behind in a sentence.
  for (const [amount] of text.matchAll(/\$[\d,]+/g)) {
    if (!allowedAmounts.has(amount)) errors.push(`Pricing: ${amount} does not match any price in lib/billing/plans.ts`)
  }
  return errors
}

/** The "Ingest channels" table in introduction.mdx is the docs' list of what connects. */
export function extractIntroChannels(introSource) {
  const match = introSource.match(/^## Ingest channels\n+((?:\|.*\n?)+)/m)
  if (!match) throw new Error('Could not find the "Ingest channels" table in content/docs/introduction.mdx')
  return match[1]
    .trim()
    .split('\n')
    .slice(2) // header row + separator row
    .map((row) => row.split('|')[1]?.trim())
    .filter(Boolean)
}

export function checkChannels(llmsText, introSource, integrationsJson) {
  const errors = []
  const intro = extractIntroChannels(introSource)
  const line = llmsText.match(/^- \*\*Connected channels:\*\*(.*)$/m)?.[1]
  if (!line) return ['llms.txt has no "Connected channels" capability bullet']
  const lower = line.toLowerCase()
  for (const channel of intro) {
    // The docs table says "Website widget"; the bullet says "a website widget".
    if (!lower.includes(channel.toLowerCase())) {
      errors.push(`Connected channels: "${channel}" is in the docs introduction table but not in llms.txt`)
    }
  }

  const known = new Set([...INTEGRATION_ORDER, ...NON_CHANNEL_INTEGRATION_PAGES])
  for (const page of integrationsJson.pages) {
    if (!known.has(page)) {
      errors.push(
        `Integrations: docs page "${page}" is neither in INTEGRATION_ORDER nor NON_CHANNEL_INTEGRATION_PAGES in scripts/sync-llms-txt.mjs`,
      )
    }
  }
  for (const slug of INTEGRATION_ORDER) {
    if (!integrationsJson.pages.includes(slug)) {
      errors.push(`Integrations: "${slug}" is listed in llms.txt but has no page in content/docs/integrations/meta.json`)
    }
  }
  return errors
}

async function walk(dir, visit, rel = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), visit, next)
    else visit(next)
  }
}

/** URL paths the site serves: docs pages, app routes (route groups removed) and files in public/. */
export async function collectServedPaths() {
  const served = new Set(['/'])
  await walk(DOCS_DIR, (file) => {
    if (!file.endsWith('.mdx')) return
    const slug = file.replace(/\.mdx$/, '').replace(/(^|\/)index$/, '')
    served.add(slug ? `/docs/${slug}` : '/docs')
  })
  await walk(APP_DIR, (file) => {
    if (!/(^|\/)(page|route)\.(ts|tsx)$/.test(file)) return
    const segments = file.split('/').slice(0, -1).filter((segment) => !/^\(.*\)$/.test(segment))
    served.add('/' + segments.join('/'))
  })
  await walk(PUBLIC_DIR, (file) => served.add('/' + file))
  return served
}

export function checkLinks(llmsText, served) {
  const errors = []
  const seen = new Set()
  for (const [, url] of llmsText.matchAll(/(https?:\/\/[^\s)>\]]+)/g)) {
    if (!url.startsWith(BASE_URL)) continue
    const route = url.slice(BASE_URL.length).replace(/[.,;:]+$/, '').split(/[?#]/)[0] || '/'
    if (seen.has(route)) continue
    seen.add(route)
    if (!served.has(route)) errors.push(`Links: ${BASE_URL}${route} does not match a docs page, app route or public file`)
  }
  return errors
}

export async function checkFacts(llmsText) {
  const [plansSource, introSource, integrationsText, served] = await Promise.all([
    readFile(PLANS_PATH, 'utf8'),
    readFile(INTRODUCTION_PATH, 'utf8'),
    readFile(INTEGRATIONS_PATH, 'utf8'),
    collectServedPaths(),
  ])
  return [
    ...checkPricing(llmsText, plansSource),
    ...checkChannels(llmsText, introSource, JSON.parse(integrationsText)),
    ...checkLinks(llmsText, served),
  ]
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
      console.error('public/llms.txt generated links are stale. Run `pnpm llms:sync` and commit the result.')
      process.exitCode = 1
    }
    const problems = await checkFacts(llmsText)
    if (problems.length > 0) {
      console.error(
        'public/llms.txt no longer matches the code or docs it describes. Run /project:update-llms-txt, or edit the file by hand:\n' +
          problems.map((problem) => `  - ${problem}`).join('\n'),
      )
      process.exitCode = 1
    }
    return
  }

  if (next !== llmsText) await writeFile(LLMS_PATH, next)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
