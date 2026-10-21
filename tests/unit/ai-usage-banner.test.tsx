// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIUsageBanner } from '@/components/dashboard/ai-usage-banner'
import type { BudgetStatus, KindStatus } from '@/lib/billing/platform-ai-budget'

// The dashboard warns a workspace on included AI usage at 80% of either
// budget and again once one is used up. It never shows an amount.

const ok: KindStatus = { included: true, warning: false, exhausted: false }
const warn: KindStatus = { included: true, warning: true, exhausted: false }
const done: KindStatus = { included: true, warning: true, exhausted: true }
const notIncluded: KindStatus = { included: false, warning: false, exhausted: false }
const models = { chat: 'gpt-5.6-terra', fast: 'gpt-5.6-luna', embedding: 'text-embedding-3-small' }
const s = (tier: 'trial' | 'plan', chat = ok, embedding = ok): BudgetStatus => ({ tier, ownChatProvider: false, chat, embedding, models })

describe('AIUsageBanner', () => {
  it('renders nothing below 80%', () => {
    const { container } = render(<AIUsageBanner status={s('plan')} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an amber warning at 80% for answers, with "this month" on a paid plan', () => {
    render(<AIUsageBanner status={s('plan', warn)} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent("You're at 80% of this month's AI limit for answers.")
    expect(banner.className).toMatch(/amber/)
    expect(screen.getByRole('link', { name: 'Add AI key' })).toHaveAttribute('href', '/settings?tab=ai')
  })

  it('leaves out "this month" during the trial', () => {
    render(<AIUsageBanner status={s('trial', ok, warn)} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent("You're at 80% of your trial AI limit for knowledge-base processing.")
    expect(banner).not.toHaveTextContent('this month')
  })

  it('turns red with the limit-reached message once a budget is exhausted', () => {
    render(<AIUsageBanner status={s('plan', ok, done)} />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent("You've reached this month's AI limit for knowledge-base processing.")
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
    expect(banner).toHaveTextContent("You've reached your trial AI limit for answers.")
    expect(banner).not.toHaveTextContent('this month')
    expect(banner.className).toMatch(/red/)
  })

  it('shows answers when both budgets are at 80%', () => {
    render(<AIUsageBanner status={s('plan', warn, warn)} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('for answers')
    expect(banner).not.toHaveTextContent('knowledge-base processing')
  })

  it('a workspace with its own chat key is pointed at an embedding key when knowledge-base usage runs out', () => {
    render(<AIUsageBanner status={{ tier: 'plan', ownChatProvider: true, chat: notIncluded, embedding: done, models }} />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('Add an OpenAI embedding key under Embeddings in Settings → AI Model')
    expect(banner).not.toHaveTextContent('Add your AI provider')
  })

  it('a workspace with its own chat key gets an 80% warning about the embedding key too', () => {
    render(<AIUsageBanner status={{ tier: 'plan', ownChatProvider: true, chat: notIncluded, embedding: warn, models }} />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent("this month's AI limit for knowledge-base processing")
    expect(banner).toHaveTextContent('Add an OpenAI embedding key')
  })

  it('never shows an amount', () => {
    const { container } = render(<AIUsageBanner status={s('plan', warn)} />)
    expect(container.textContent).not.toMatch(/\$/)
  })
})
