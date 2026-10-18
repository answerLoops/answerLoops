// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DraftSkippedNotice } from '@/components/tickets/draft-skipped-notice'

describe('DraftSkippedNotice', () => {
  it('monthly limit: says the limit was reached, links to Settings → AI Model, and mentions the monthly reset', () => {
    render(<DraftSkippedNotice reason="ai_limit_reached" />)
    expect(screen.getByText(/reached this month's AI limit/i)).toBeTruthy()
    expect(screen.getByText(/limit resets next month/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /settings → ai model/i }).getAttribute('href')).toBe('/settings?tab=ai')
  })

  it('trial limit: links to Settings and does not promise a reset', () => {
    render(<DraftSkippedNotice reason="trial_ai_limit_reached" />)
    expect(screen.getByText(/reached your trial AI limit/i)).toBeTruthy()
    expect(screen.queryByText(/resets/i)).toBeNull()
    expect(screen.getByRole('link', { name: /settings → ai model/i }).getAttribute('href')).toBe('/settings?tab=ai')
  })

  it('no active plan: points at Billing, not at the AI provider settings', () => {
    render(<DraftSkippedNotice reason="no_active_plan" />)
    expect(screen.getByText(/no active plan/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /billing/i }).getAttribute('href')).toBe('/billing')
    expect(screen.queryByText(/provider/i)).toBeNull()
  })

  it.each([
    ['ai_unavailable', /couldn't draft a reply/i],
    ['bug_or_feature', /bug reports and feature requests aren't answered automatically/i],
    ['unverified_sender', /couldn't verify the sender/i],
  ] as const)('%s: explains in plain words with no link and no provider hint', (reason, text) => {
    render(<DraftSkippedNotice reason={reason} />)
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/provider/i)).toBeNull()
  })

  it('shows a neutral message, with no link or provider hint, for tickets with no recorded reason', () => {
    render(<DraftSkippedNotice reason={null} />)
    expect(screen.getByText(/no ai draft was generated for this ticket/i)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/provider/i)).toBeNull()
  })
})
