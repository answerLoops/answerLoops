// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TicketContent } from '@/components/tickets/ticket-content'
import { splitEmailQuote } from '@/lib/tickets/email-quote'

afterEach(cleanup)

const FOOTER =
  '— Reply to this email directly, view it on GitHub https://github.com/o/r/pull/1?email_token=ABC, or unsubscribe https://github.com/notifications/unsubscribe-auth/XYZ. You are receiving this because you were mentioned.Message ID: <o/r/pull/1/c1@github.com>'

const FRENCH_REPLY = [
  'Hello Nathan, Thank you for your feedback.',
  'Le lun. 23 nov. 2026, 15:51, Nathan Tarbert <notifications@github.com> a écrit :',
  'NathanTarbert left a comment (o/r#1) https://github.com/o/r/pull/1#issuecomment-1',
  'Hey @someone, thank you for the PR.',
  FOOTER,
].join('\n')

describe('splitEmailQuote', () => {
  it('separates a reply from the quoted notification under it', () => {
    const { reply, quoted } = splitEmailQuote(FRENCH_REPLY)
    expect(reply).toBe('Hello Nathan, Thank you for your feedback.')
    expect(quoted).toMatch(/^Le lun\. 23 nov\./)
    expect(quoted).toContain('Reply to this email directly')
  })

  it('handles the English marker', () => {
    const { reply, quoted } = splitEmailQuote('Thanks!\n\nOn Mon, Nov 23, 2026 at 3:51 PM Someone <a@b.c> wrote:\n> hi')
    expect(reply).toBe('Thanks!')
    expect(quoted).toMatch(/^On Mon/)
  })

  it('cuts at the GitHub footer when there is no quote line', () => {
    const { reply, quoted } = splitEmailQuote(`Looks good to me.\n${FOOTER}`)
    expect(reply).toBe('Looks good to me.')
    expect(quoted).toContain('unsubscribe')
  })

  it('leaves ordinary comments untouched', () => {
    expect(splitEmailQuote('Plain comment.\n\nSecond paragraph.')).toEqual({
      reply: 'Plain comment.\n\nSecond paragraph.',
      quoted: null,
    })
  })

  it('does not cut when the marker is the first line, since there is no reply above it', () => {
    const text = 'Someone wrote:\nthe original'
    expect(splitEmailQuote(text)).toEqual({ reply: text, quoted: null })
  })
})

describe('TicketContent with an emailed GitHub reply', () => {
  it('shows the reply and keeps the quoted email behind a closed toggle', () => {
    render(<TicketContent sourcePlatform="github" content={FRENCH_REPLY} />)
    expect(screen.getByText('Hello Nathan, Thank you for your feedback.')).toBeInTheDocument()
    const details = screen.getByTestId('quoted-email') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(screen.getByText('Show quoted email')).toBeInTheDocument()
    expect(details.textContent).toContain('Reply to this email directly')
  })

  it('shows no toggle for a comment without a quote', () => {
    render(<TicketContent sourcePlatform="github" content="Just a comment." />)
    expect(screen.queryByTestId('quoted-email')).toBeNull()
  })

  it('does not split messages from other platforms', () => {
    render(<TicketContent sourcePlatform="slack" content={FRENCH_REPLY} />)
    expect(screen.queryByTestId('quoted-email')).toBeNull()
  })
})
