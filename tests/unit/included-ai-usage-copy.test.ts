import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { INCLUDED_AI_POINTS, INCLUDED_AI_SUMMARY } from '@/lib/marketing/plan-summary'
import { PRICING_FAQ } from '@/lib/marketing/pricing'

/**
 * What the pricing surfaces say about included AI usage.
 *
 * A buyer reading "500 estimated AI replies/month" next to a separate "AI usage
 * limit" could not tell which one ran out first or what spends it. The copy now
 * answers that in replies, never in money: the amount of AI usage behind a plan
 * is not something we publish, and nobody quotes their model spend as a
 * headline number.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('included AI usage summary', () => {
  it('says what uses the included usage, including drafts held for the team', () => {
    expect(INCLUDED_AI_SUMMARY).toMatch(/Every question the AI works on uses some of it, including drafts held for your team/)
  })

  it('explains why plans list estimated AI replies', () => {
    expect(INCLUDED_AI_SUMMARY).toMatch(/That is why each plan lists estimated AI replies/)
    expect(INCLUDED_AI_SUMMARY).toMatch(/longer questions and sources use more/)
  })

  it('says which limit can run out first and what happens then', () => {
    expect(INCLUDED_AI_SUMMARY).toMatch(/a plan can reach its included AI usage before its AI reply allowance/)
    expect(INCLUDED_AI_SUMMARY).toMatch(/drafting pauses until your usage resets next month/)
    expect(INCLUDED_AI_SUMMARY).toMatch(/the trial's does not reset/)
  })

  it('says how to lift the limit and who then bills for it', () => {
    expect(INCLUDED_AI_SUMMARY).toMatch(/connect your own AI provider/)
    expect(INCLUDED_AI_SUMMARY).toMatch(/pay that service directly/)
  })

  it('never names an amount of money or calls the usage a budget', () => {
    expect(INCLUDED_AI_SUMMARY).not.toMatch(/\$|USD|dollar|budget/i)
  })
})

describe('where the summary reaches customers', () => {
  it('is the answer to the pricing FAQ about model costs', () => {
    const item = PRICING_FAQ.find((entry) => /model costs/i.test(entry.q))
    expect(item?.a.startsWith(INCLUDED_AI_SUMMARY)).toBe(true)
  })

  it('is the block under the plan cards on the pricing page, one paragraph per point', () => {
    const page = read('app/pricing/page.tsx')
    expect(page).toContain('INCLUDED_AI_POINTS.map')
    expect(page).toContain('Plan your total cost')
  })

  it('is split into short points that read as the same text as the single summary', () => {
    expect(INCLUDED_AI_POINTS.length).toBe(4)
    expect(INCLUDED_AI_POINTS.join(' ')).toBe(INCLUDED_AI_SUMMARY)
    for (const point of INCLUDED_AI_POINTS) expect(point.length, point).toBeLessThan(300)
  })

  it('keeps the pricing page headline free of the word budget', () => {
    expect(read('app/pricing/page.tsx')).not.toMatch(/AI usage budget/)
  })

  it('is mirrored, in the same terms, in the billing docs and llms.txt', () => {
    for (const file of ['content/docs/reference/billing-plans.mdx', 'content/docs/product/billing.mdx']) {
      const text = read(file)
      expect(text, file).toMatch(/including drafts held for your team/)
      expect(text, file).toMatch(/\*estimated\* AI replies/)
    }
    const llms = read('public/llms.txt')
    expect(llms).toMatch(/including drafts held for the team/)
    expect(llms).toMatch(/estimated AI replies a month/)
  })

  it('states no dollar amount of included AI usage anywhere customers read about it', () => {
    for (const file of [
      'app/pricing/page.tsx',
      'lib/marketing/plan-summary.ts',
      'content/docs/reference/billing-plans.mdx',
      'content/docs/product/billing.mdx',
      'content/docs/product/ai-config.mdx',
    ]) {
      const text = read(file)
      expect(text, file).not.toMatch(/included (?:AI )?usage[^.\n]{0,40}\$\d/i)
      expect(text, file).not.toMatch(/\$\d+[^.\n]{0,40}(?:of|in) (?:included )?(?:AI )?usage/i)
    }
  })
})
