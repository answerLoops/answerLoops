import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  checkChannels,
  checkFacts,
  checkLinks,
  checkPricing,
  collectServedPaths,
  extractIntroChannels,
  extractPlanFacts,
  syncLlmsText,
} from '@/scripts/sync-llms-txt.mjs'

describe('llms.txt synchronization', () => {
  it('keeps generated public and integration links aligned with their sources', async () => {
    const root = process.cwd()
    const [llmsText, sitemapSource, integrationsText] = await Promise.all([
      readFile(path.join(root, 'public/llms.txt'), 'utf8'),
      readFile(path.join(root, 'app/sitemap.ts'), 'utf8'),
      readFile(path.join(root, 'content/docs/integrations/meta.json'), 'utf8'),
    ])

    expect(syncLlmsText(llmsText, sitemapSource, JSON.parse(integrationsText))).toBe(llmsText)
  })
})

describe('llms.txt fact checks', () => {
  const read = (file: string) => readFile(path.join(process.cwd(), file), 'utf8')

  it('passes against the real llms.txt, plans, docs and routes', async () => {
    expect(await checkFacts(await read('public/llms.txt'))).toEqual([])
  })

  describe('pricing', () => {
    it('reads the plan facts from lib/billing/plans.ts', async () => {
      const facts = extractPlanFacts(await read('lib/billing/plans.ts'))
      expect(facts.trialDays).toBe(14)
      expect(facts.plans.pro).toMatchObject({ monthly: 149, quota: 3000, overage: 5, annualEquivalent: 119, annualTotal: 1428 })
      expect(facts.plans.enterprise).toMatchObject({ monthly: 499, quota: null })
    })

    it('flags a changed monthly price', async () => {
      const llms = (await read('public/llms.txt')).replace('Standard $49 with', 'Standard $59 with')
      const errors = checkPricing(llms, await read('lib/billing/plans.ts'))
      expect(errors.some((e) => e.includes('Standard $49'))).toBe(true)
      expect(errors.some((e) => e.includes('$59'))).toBe(true)
    })

    it('flags a changed answer allowance, overage rate and trial length', async () => {
      const plans = await read('lib/billing/plans.ts')
      const base = await read('public/llms.txt')
      expect(checkPricing(base.replace('with 3,000', 'with 5,000'), plans).join()).toContain('Pro $149 with 3,000')
      expect(checkPricing(base.replace('$5 per additional', '$7 per additional'), plans).join()).toContain('$5 per additional block of 100')
      expect(checkPricing(base.replace('14-day trial', '30-day trial'), plans).join()).toContain('14-day trial')
    })

    it('flags a price changed in the code but not in llms.txt', async () => {
      const plans = (await read('lib/billing/plans.ts')).replace('priceMonthly: 14900', 'priceMonthly: 17900')
      const errors = checkPricing(await read('public/llms.txt'), plans)
      expect(errors.join()).toContain('Pro $179')
    })

    it('flags a leftover price that is no longer in the plan table', async () => {
      const llms = (await read('public/llms.txt')).replace('## Integrations', 'Legacy tier $29.\n\n## Integrations')
      expect(checkPricing(llms, await read('lib/billing/plans.ts')).join()).toContain('$29 does not match')
    })
  })

  describe('channels and integrations', () => {
    it('reads the channel names from the introduction table', async () => {
      expect(extractIntroChannels(await read('content/docs/introduction.mdx'))).toEqual(
        expect.arrayContaining(['Discord', 'Slack', 'Website widget', 'Google Chat']),
      )
    })

    it('flags a channel in the docs table that llms.txt does not name', async () => {
      const intro = await read('content/docs/introduction.mdx')
      const withNew = intro.replace('| Google Chat |', '| Matrix | Bot token | Room messages |\n| Google Chat |')
      const errors = checkChannels(await read('public/llms.txt'), withNew, JSON.parse(await read('content/docs/integrations/meta.json')))
      expect(errors).toEqual(['Connected channels: "Matrix" is in the docs introduction table but not in llms.txt'])
    })

    it('flags a new integration docs page nobody has classified', async () => {
      const meta = JSON.parse(await read('content/docs/integrations/meta.json'))
      meta.pages.push('zendesk')
      const errors = checkChannels(await read('public/llms.txt'), await read('content/docs/introduction.mdx'), meta)
      expect(errors.join()).toContain('docs page "zendesk"')
    })

    it('flags an integration listed in llms.txt whose docs page was removed', async () => {
      const meta = JSON.parse(await read('content/docs/integrations/meta.json'))
      meta.pages = meta.pages.filter((page: string) => page !== 'telegram')
      const errors = checkChannels(await read('public/llms.txt'), await read('content/docs/introduction.mdx'), meta)
      expect(errors.join()).toContain('"telegram" is listed in llms.txt but has no page')
    })
  })

  describe('links', () => {
    it('collects docs pages, route-group pages, route handlers and public files', async () => {
      const served = await collectServedPaths()
      for (const route of ['/docs', '/docs/integrations/slack', '/pricing', '/api/mcp', '/openapi.json', '/.well-known/oauth-protected-resource', '/llms.txt']) {
        expect(served.has(route), route).toBe(true)
      }
      expect([...served].some((route) => route.includes('('))).toBe(false)
    })

    it('flags a link to a docs page that does not exist', async () => {
      const llms = (await read('public/llms.txt')) + '\n- Gone: https://answerloops.com/docs/integrations/removed-page\n'
      expect(checkLinks(llms, await collectServedPaths())).toEqual([
        'Links: https://answerloops.com/docs/integrations/removed-page does not match a docs page, app route or public file',
      ])
    })

    it('ignores links to other hosts', async () => {
      expect(checkLinks('See https://example.com/nope and https://github.com/answerLoops/answerLoops.', await collectServedPaths())).toEqual([])
    })
  })
})
