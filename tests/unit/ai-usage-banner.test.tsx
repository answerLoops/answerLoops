// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIUsageBanner } from '@/components/dashboard/ai-usage-banner'
import type { BudgetStatus, KindStatus } from '@/lib/billing/platform-ai-budget'

// The dashboard warns a workspace on included AI usage at 80% of either
// budget and again once one is used up. It never shows an amount.

const ok: KindStatus = { fraction: 0.1, warning: false, exhausted: false }
const warn: KindStatus = { fraction: 0.85, warning: true, exhausted: false }
const done: KindStatus = { fraction: 1.02, warning: true, exhausted: true }
const models = { chat: 'gpt-5.6-terra', fast: 'gpt-5.6-luna', embedding: 'text-embedding-3-small' }
const s = (tier: 'trial' | 'plan', chat = ok, embedding = ok): BudgetStatus => ({ tier, chat, embedding, models })

describe('AIUsageBanner', () => {
  it('renders nothing below 80%', () => {
    const { container } = render(<AIUsageBanner status={s('plan')} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an amber warning at 80% for answers, with "this month" on a paid plan', () => {
    render(<AIUsageBanner status={s('plan', warn)} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent("You've used 80% of your included AI usage for answers this month.")
    expect(banner.className).toMatch(/amber/)
    expect(screen.getByRole('link', { name: 'Add AI key' })).toHaveAttribute('href', '/settings?tab=ai')
  })

  it('leaves out "this month" during the trial', () => {
    render(<AIUsageBanner status={s('trial', ok, warn)} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent("You've used 80% of your included trial AI usage for knowledge-base processing.")
    expect(banner).not.toHaveTextContent('this month')
  })

  it('turns red with the used-up message once a budget is exhausted', () => {
    render(<AIUsageBanner status={s('plan', ok, done)} />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('This workspace has used its included AI usage for knowledge-base processing this month.')
    expect(banner.className).toMatch(/red/)
  })

  it('shows the used-up budget over one that is only at 80%', () => {
    render(<AIUsageBanner status={s('plan', warn, done)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('knowledge-base processing')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows answers when both are used up', () => {
    render(<AIUsageBanner status={s('plan', done, done)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('for answers')
  })

  it('uses the trial wording in red once the trial usage is used up', () => {
    render(<AIUsageBanner status={s('trial', done)} />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('This workspace has used its included trial AI usage for answers.')
    expect(banner).not.toHaveTextContent('this month')
    expect(banner.className).toMatch(/red/)
  })

  it('shows answers when both budgets are at 80%', () => {
    render(<AIUsageBanner status={s('plan', warn, warn)} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('for answers')
    expect(banner).not.toHaveTextContent('knowledge-base processing')
  })

  it('never shows an amount', () => {
    const { container } = render(<AIUsageBanner status={s('plan', warn)} />)
    expect(container.textContent).not.toMatch(/\$/)
  })
})
