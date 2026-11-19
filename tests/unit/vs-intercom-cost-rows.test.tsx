import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANS } from '@/lib/billing/plans'

// The comparison component pulls in the marketing layout, which is not what is
// under test. A stub lets the test read the rows exactly as the page hands them
// over, as the props of the element the page returns.
vi.mock('@/components/marketing/comparison-page', () => ({
  ComparisonPage: () => null,
}))
vi.mock('@/lib/site', () => ({ marketingSiteEnabled: () => true }))

type Row = { feature: string; us: string; them: string }
type Props = {
  rows: Row[]
  reviewedOn?: string | null
  bestFor: { us: string; them: string }
}

async function pageProps(): Promise<Props> {
  const { default: Page } = await import('@/app/vs/intercom/page')
  const element = Page() as unknown as { props: Props }
  return element.props
}

const row = (rows: Row[], feature: RegExp) => {
  const found = rows.find((r) => feature.test(r.feature))
  if (!found) throw new Error(`no row matching ${feature}`)
  return found
}

beforeEach(() => {
  vi.resetModules()
})

describe('/vs/intercom pricing rows', () => {
  it('describes our pricing as a flat plan with an estimated number of replies by tier', async () => {
    const { rows } = await pageProps()
    expect(row(rows, /^Pricing model$/).us).toBe(
      'Flat monthly plan, with an estimated number of AI replies included based on the pricing tier.',
    )
  })

  it('quotes Fin per outcome, one per conversation, with no setup or platform fees', async () => {
    const { rows } = await pageProps()
    const them = row(rows, /^Pricing model$/).them
    expect(them).toContain('$0.99 per outcome')
    expect(them).toMatch(/One outcome is billed per conversation/)
    expect(them).toMatch(/no setup or platform fees/)
  })

  it('works the 500-question example out from the plan table and from Fin’s per-outcome price', async () => {
    const { rows } = await pageProps()
    const example = row(rows, /^Example: 500 answered questions a month$/)
    expect(example.us).toContain(`$${PLANS.standard.priceMonthly / 100} on Standard`)
    expect(example.us).toContain(`estimated ${PLANS.standard.deflectionsPerMonth!.toLocaleString('en-US')} AI replies`)
    expect(example.them).toContain('500 resolutions at $0.99 is $495')
  })

  it('says the two sides count different things, and what does not count on ours', async () => {
    const { rows } = await pageProps()
    const us = row(rows, /^Example:/).us
    expect(us).toMatch(/AI replies, not confirmed resolutions/)
    expect(us).toMatch(/Drafts held for your team do not count/)
  })

  it('names the extra costs on Fin’s side: Intercom seats, or the minimum on another helpdesk', async () => {
    const { rows } = await pageProps()
    const them = row(rows, /^Example:/).them
    expect(them).toMatch(/Intercom is your helpdesk, its seats are extra \(listed at \$19 per seat per month/)
    expect(them).toMatch(/minimum of 50 outcomes a month/)
  })
})

describe('/vs/intercom review row', () => {
  it('describes our review step', async () => {
    const { rows } = await pageProps()
    const us = row(rows, /^Second-AI review before posting$/).us
    expect(us).toMatch(/separate review agent checks every draft against its sources/)
    expect(us).toMatch(/above your threshold/)
  })

  it('does not claim Fin lacks a review step, only that its site does not describe one', async () => {
    const { rows } = await pageProps()
    const them = row(rows, /^Second-AI review before posting$/).them
    expect(them).toMatch(/does not describe a second AI checking each answer/)
    expect(them).not.toMatch(/\b(?:has no|lacks|without|no review)\b/i)
  })
})

describe('/vs/intercom page as a whole', () => {
  it('keeps every earlier row', async () => {
    const { rows } = await pageProps()
    for (const feature of ['Channels', 'Answer workflow', 'Deployment']) {
      expect(rows.map((r) => r.feature)).toContain(feature)
    }
  })

  it('carries the review date for the figures it quotes', async () => {
    expect((await pageProps()).reviewedOn).toBe('November 17, 2026')
  })

  it('balances the cost point on both sides of "consider"', async () => {
    const { bestFor } = await pageProps()
    expect(bestFor.us).toMatch(/flat monthly price instead of a per-resolution charge/)
    expect(bestFor.them).toMatch(/pay only when Fin resolves a conversation/)
  })
})
