import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PRICING_FAQ } from '@/lib/marketing/pricing'

/**
 * One word for the monthly allowance everywhere a customer reads about it.
 *
 * The allowance used to be called "deflections" in billing and docs, "automated
 * answers" on the pricing page and "AI replies" on the pricing card, which left
 * a reader unable to tell whether they were the same limit. It is now "AI
 * replies". "Deflection" stays only where it names something else: the
 * Automatic Deflections setting, the Analytics deflection rate, the
 * `deflection_limit_reached` API error code, and the one sentence that links
 * the two words for a reader who meets both.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

const ALLOWANCE_SURFACES = [
  'app/(dashboard)/billing/page.tsx',
  'components/billing/embedded-checkout-panel.tsx',
  'components/marketing/pricing-toggle.tsx',
  'lib/marketing/pricing.ts',
  'lib/marketing/plan-summary.ts',
  'lib/mcp/tools.ts',
  'lib/agent/openapi-spec.ts',
  'lib/agent/scopes.ts',
  'public/llms.txt',
  'skills/operate/SKILL.md',
  'content/docs/quickstart-cloud.mdx',
  'content/docs/introduction.mdx',
  'content/docs/product/billing.mdx',
  'content/docs/product/chat-widget.mdx',
  'content/docs/reference/billing-plans.mdx',
  'content/docs/reference/api/generateAnswer.mdx',
  'content/docs/integrations/mcp.mdx',
  'content/docs/integrations/agent-api.mdx',
]

/** What may still say "deflection" on those pages, removed before checking. */
function withoutAllowedUses(text: string): string {
  return text
    .replace(/\(Analytics and the \*\*Automatic Deflections\*\* (?:setting )?(?:use the word|call the same thing a) \*deflections?\*[^)]*\)/g, '')
    .replace(/Automatic Deflections/g, '')
    // The docs page is still named for the setting, so its link text and path stay.
    .replace(/\[AI deflection\]/g, '')
    .replace(/\/docs\/product\/ai-deflection/g, '')
    .replace(/deflection_limit_reached/g, '')
}

describe('the monthly allowance is called AI replies', () => {
  for (const file of ALLOWANCE_SURFACES) {
    it(`${file} does not call it a deflection or an automated answer`, () => {
      const text = withoutAllowedUses(read(file))
      const stray = text.match(/.{0,50}\b(?:deflections?|automated[- ]answers?|answer allowances?)\b.{0,50}/gi) ?? []
      expect(stray, stray.join('\n')).toEqual([])
    })
  }

  it('the terms define an AI reply and no longer define a deflection', () => {
    const terms = read('app/terms/page.tsx')
    expect(terms).toContain('&ldquo;AI reply&rdquo;')
    expect(terms).not.toMatch(/deflection/i)
  })

  it('keeps the error code for API callers, which is a contract, not copy', () => {
    expect(read('lib/agent/openapi-spec.ts')).toContain("'deflection_limit_reached'")
  })
})

describe('what counts toward the allowance is stated plainly', () => {
  const answer = (q: RegExp) => PRICING_FAQ.find((item) => q.test(item.q))?.a ?? ''

  it('the pricing FAQ says drafts held for review do not count', () => {
    const a = answer(/counts toward/i)
    expect(a).toMatch(/Drafts held for your team to review do not count/)
    expect(a).toMatch(/later approves or edits/)
  })

  it('the pricing FAQ defines an AI reply', () => {
    expect(answer(/counts toward/i)).toMatch(/^An AI reply is an answer answerLoops posts on its own/)
  })

  it('the checkout FAQ says drafts held for your team never count', () => {
    expect(read('components/billing/embedded-checkout-panel.tsx')).toMatch(/Drafts held for your team never count/)
  })

  it('the billing docs say drafts held for review do not count', () => {
    for (const file of ['content/docs/reference/billing-plans.mdx', 'content/docs/product/billing.mdx']) {
      expect(read(file), file).toMatch(/Drafts held for your team to review do not count/)
    }
  })

  it('the docs link the two words once, for a reader who meets both', () => {
    for (const file of ['content/docs/reference/billing-plans.mdx', 'content/docs/product/billing.mdx']) {
      expect(read(file), file).toMatch(/\*\*Automatic Deflections\*\*[^)]*\*deflection\*/)
    }
  })
})

describe('every stated plan allowance says estimated, as the pricing cards do', () => {
  const cases: [string, RegExp][] = [
    // Billing and the pricing cards both read this one label.
    ['lib/marketing/pricing.ts', /estimated AI replies\/month/],
    ['app/(dashboard)/billing/page.tsx', /replyAllowanceLabel/],
    ['components/billing/embedded-checkout-panel.tsx', /estimated AI replies\/mo/],
    ['content/docs/reference/billing-plans.mdx', /500 estimated AI replies a month/],
    ['content/docs/reference/billing-plans.mdx', /3,000 estimated AI replies a month/],
    ['content/docs/reference/billing-plans.mdx', /Estimated AI replies\/mo/],
    ['content/docs/product/billing.mdx', /Included estimated AI replies per month/],
    ['content/docs/quickstart-cloud.mdx', /Estimated AI replies per month/],
    ['components/marketing/pricing-toggle.tsx', /replyAllowanceLabel/],
    ['components/marketing/pricing-comparison-table.tsx', /Estimated AI replies \/ month/],
  ]
  for (const [file, pattern] of cases) {
    it(`${file} matches ${pattern}`, () => {
      expect(read(file)).toMatch(pattern)
    })
  }
})

