// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PricingToggle } from '@/components/marketing/pricing-toggle'
import { ORDERED_PLANS } from '@/lib/billing/plans'
import { START_HREF, TALK_TO_US_HREF } from '@/components/marketing/nav-shared'

const prices = [
  {
    name: 'Standard',
    id: 'standard',
    annualMonthly: '$39',
    annualTotal: '$468',
    monthly: '$49',
  },
  {
    name: 'Pro',
    id: 'pro',
    annualMonthly: '$119',
    annualTotal: '$1,428',
    monthly: '$149',
  },
]

// Enterprise has no public price, so it is not in the list above. These are
// its amounts in lib/billing/plans.ts, which must never appear on the page.
const ENTERPRISE_AMOUNTS = ['$499', '$399', '$4,788']

describe('PricingToggle', () => {
  it('shows Custom pricing and a Talk to us button on Enterprise instead of a price and a trial', async () => {
    const user = userEvent.setup()
    const { container } = render(<PricingToggle plans={ORDERED_PLANS} />)
    const enterprise = within(
      screen.getByRole('region', { name: 'Enterprise plan' }),
    )
    expect(enterprise.getByText('Custom')).toBeInTheDocument()
    expect(enterprise.getByText('pricing')).toBeInTheDocument()
    expect(
      enterprise.getByRole('link', { name: 'Talk to us' }),
    ).toHaveAttribute('href', TALK_TO_US_HREF)
    expect(
      enterprise.queryByRole('link', { name: /free trial/i }),
    ).not.toBeInTheDocument()
    // Neither billing interval brings the price back anywhere on the page.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const amount of ENTERPRISE_AMOUNTS) {
        expect(container).not.toHaveTextContent(amount)
      }
      await user.click(screen.getByRole('switch', { name: 'Use annual billing' }))
    }
  })

  it('shows the monthly equivalent and full annual charge for each plan by default', () => {
    render(<PricingToggle plans={ORDERED_PLANS} />)
    expect(
      screen.getByRole('switch', { name: 'Use annual billing' }),
    ).toBeChecked()
    for (const price of prices) {
      const cardElement = screen.getByRole('region', {
        name: `${price.name} plan`,
      })
      const card = within(cardElement)
      expect(card.getByText(price.annualMonthly)).toBeInTheDocument()
      expect(
        card.getByText(`${price.annualTotal} billed annually`),
      ).toBeInTheDocument()
      for (const otherPrice of prices.filter(({ id }) => id !== price.id)) {
        expect(cardElement).not.toHaveTextContent(otherPrice.annualTotal)
      }
      expect(cardElement).not.toHaveTextContent(/\$[\d,]+\.\d{2}/)
      expect(
        card.getByRole('link', { name: 'Start 14-day free trial' }),
      ).toHaveAttribute('href', START_HREF)
      // The trial terms are stated once, in the FAQ. They are not repeated
      // under every plan's button.
      expect(card.queryByText(/No card required/)).not.toBeInTheDocument()
    }
  })

  it('updates prices and charge disclosure while keeping the shared trial destination', async () => {
    const user = userEvent.setup()
    render(<PricingToggle plans={ORDERED_PLANS} />)
    const toggle = screen.getByRole('switch', { name: 'Use annual billing' })
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    for (const price of prices) {
      const card = within(
        screen.getByRole('region', { name: `${price.name} plan` }),
      )
      expect(card.getByText(price.monthly)).toBeInTheDocument()
      expect(card.getByText('Billed monthly')).toBeInTheDocument()
      expect(card.queryByText(/billed annually/i)).not.toBeInTheDocument()
      for (const annualPrice of prices) {
        expect(
          card.queryByText(annualPrice.annualTotal, { exact: false }),
        ).not.toBeInTheDocument()
      }
      expect(
        card.getByRole('link', { name: 'Start 14-day free trial' }),
      ).toHaveAttribute('href', START_HREF)
      // The trial terms are stated once, in the FAQ. They are not repeated
      // under every plan's button.
      expect(card.queryByText(/No card required/)).not.toBeInTheDocument()
    }
    await user.click(toggle)
    expect(toggle).toBeChecked()
    for (const price of prices) {
      const cardElement = screen.getByRole('region', {
        name: `${price.name} plan`,
      })
      const card = within(cardElement)
      expect(card.getByText(price.annualMonthly)).toBeInTheDocument()
      expect(
        card.getByText(`${price.annualTotal} billed annually`),
      ).toBeInTheDocument()
      for (const otherPrice of prices.filter(({ id }) => id !== price.id)) {
        expect(cardElement).not.toHaveTextContent(otherPrice.annualTotal)
      }
      expect(
        card.getByRole('link', { name: 'Start 14-day free trial' }),
      ).toHaveAttribute('href', START_HREF)
    }
  })

  it('discloses the different usage limits and overage rules on their respective plans', () => {
    render(<PricingToggle plans={ORDERED_PLANS} />)
    const standard = within(
      screen.getByRole('region', { name: 'Standard plan' }),
    )
    const pro = within(screen.getByRole('region', { name: 'Pro plan' }))
    const enterprise = within(
      screen.getByRole('region', { name: 'Enterprise plan' }),
    )
    expect(
      standard.getByText('500 estimated AI replies/month'),
    ).toBeInTheDocument()
    expect(
      standard.getByText('Replies pause at the limit. Pro includes 3,000.'),
    ).toBeInTheDocument()
    expect(
      pro.getByText('3,000 estimated AI replies/month'),
    ).toBeInTheDocument()
    expect(
      pro.getByText('Then $5 per additional 100 replies.'),
    ).toBeInTheDocument()
    expect(enterprise.getByText('Unlimited AI replies')).toBeInTheDocument()
    expect(enterprise.getByText('No overage charges.')).toBeInTheDocument()
    expect(pro.getByText('Recommended')).toBeInTheDocument()
    expect(standard.queryByText('Recommended')).not.toBeInTheDocument()
    expect(enterprise.queryByText('Recommended')).not.toBeInTheDocument()
  })

  it('offers a Talk to us link on the Enterprise plan only', () => {
    render(<PricingToggle plans={ORDERED_PLANS} />)
    const enterprise = within(
      screen.getByRole('region', { name: 'Enterprise plan' }),
    )
    expect(
      enterprise.getByRole('link', { name: 'Talk to us' }),
    ).toHaveAttribute('href', TALK_TO_US_HREF)
    for (const name of ['Standard plan', 'Pro plan']) {
      const card = within(screen.getByRole('region', { name }))
      expect(card.queryByRole('link', { name: 'Talk to us' })).toBeNull()
    }
    expect(screen.getAllByRole('link', { name: 'Talk to us' })).toHaveLength(1)
  })
})
