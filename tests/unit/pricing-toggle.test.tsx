// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PricingToggle } from '@/components/marketing/pricing-toggle'
import { ORDERED_PLANS } from '@/lib/billing/plans'

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
  {
    name: 'Enterprise',
    id: 'enterprise',
    annualMonthly: '$399',
    annualTotal: '$4,788',
    monthly: '$499',
  },
]

describe('PricingToggle', () => {
  it('defaults to exact annual prices and carries each plan and annual interval to checkout', () => {
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
      expect(card.getByText('Billed annually')).toBeInTheDocument()
      for (const otherPrice of prices) {
        expect(cardElement).not.toHaveTextContent(otherPrice.annualTotal)
      }
      expect(cardElement).not.toHaveTextContent(/\$[\d,]+\.\d{2}/)
      expect(
        card.getByRole('link', { name: 'Start 14-day free trial' }),
      ).toHaveAttribute('href', `/login?plan=${price.id}&interval=annual`)
      expect(card.getByText(/Card required/)).toHaveTextContent(
        'Cancel before the 14-day trial ends',
      )
    }
  })

  it('updates prices, charge disclosure, and checkout interval together in both directions', async () => {
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
      expect(
        card.getByRole('link', { name: 'Start 14-day free trial' }),
      ).toHaveAttribute('href', `/login?plan=${price.id}&interval=monthly`)
      expect(card.getByText(/Card required/)).toHaveTextContent(
        'Cancel before the 14-day trial ends',
      )
    }
    await user.click(toggle)
    expect(toggle).toBeChecked()
    for (const price of prices) {
      const cardElement = screen.getByRole('region', {
        name: `${price.name} plan`,
      })
      const card = within(cardElement)
      expect(card.getByText(price.annualMonthly)).toBeInTheDocument()
      expect(card.getByText('Billed annually')).toBeInTheDocument()
      for (const otherPrice of prices) {
        expect(cardElement).not.toHaveTextContent(otherPrice.annualTotal)
      }
      expect(
        card.getByRole('link', { name: 'Start 14-day free trial' }),
      ).toHaveAttribute('href', `/login?plan=${price.id}&interval=annual`)
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
      standard.getByText('500 automated answers/month'),
    ).toBeInTheDocument()
    expect(
      standard.getByText('Automatic replies pause at the limit.'),
    ).toBeInTheDocument()
    expect(pro.getByText('3,000 automated answers/month')).toBeInTheDocument()
    expect(
      pro.getByText('Then $5 per additional block of 100.'),
    ).toBeInTheDocument()
    expect(
      enterprise.getByText('Unlimited automated answers'),
    ).toBeInTheDocument()
    expect(
      enterprise.getByText('No automated-answer overage charges.'),
    ).toBeInTheDocument()
    expect(pro.getByText('Recommended')).toBeInTheDocument()
    expect(standard.queryByText('Recommended')).not.toBeInTheDocument()
    expect(enterprise.queryByText('Recommended')).not.toBeInTheDocument()
  })
})
