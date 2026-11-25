// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CalloutCard,
  CardSkeleton,
  ChoicesCard,
  FollowUpsCard,
  ContactCard,
  LinkCard,
  StepsCard,
  WidgetActionsProvider,
} from '@/app/widget/[widgetToken]/genui-cards'

describe('StepsCard', () => {
  it('numbers the steps in order and shows details only when given', () => {
    render(
      <StepsCard
        data={{
          title: 'Reset your password',
          steps: [{ title: 'Open settings', detail: 'Top-right menu' }, { title: 'Click Reset' }],
        }}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('1')
    expect(items[0].textContent).toContain('Open settings')
    expect(items[0].textContent).toContain('Top-right menu')
    expect(items[1].textContent).toContain('2')
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeTruthy()
  })

  it('renders model text as text, never as markup', () => {
    const { container } = render(
      <StepsCard data={{ title: '<img src=x onerror=alert(1)>', steps: [{ title: '<b>bold</b>' }, { title: 'b' }] }} />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })
})

describe('ChoicesCard', () => {
  const data = { prompt: 'Which plan?', options: [{ label: 'Starter' }, { label: 'Pro' }] }

  it('sends the tapped option as the visitor message, then locks every option', async () => {
    const send = vi.fn()
    render(
      <WidgetActionsProvider value={{ send, canReply: true, activeFollowUpId: null }}>
        <ChoicesCard data={data} />
      </WidgetActionsProvider>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pro' }))

    expect(send).toHaveBeenCalledExactlyOnceWith('Pro')
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Starter' }))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('is inert while a reply is still streaming', async () => {
    const send = vi.fn()
    render(
      <WidgetActionsProvider value={{ send, canReply: false, activeFollowUpId: null }}>
        <ChoicesCard data={data} />
      </WidgetActionsProvider>
    )
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pro' }))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('CalloutCard', () => {
  it('shows title and body for each tone', () => {
    for (const tone of ['info', 'warning', 'success'] as const) {
      const { unmount } = render(<CalloutCard data={{ tone, title: `T-${tone}`, body: `B-${tone}` }} />)
      expect(screen.getByText(`T-${tone}`)).toBeTruthy()
      expect(screen.getByText(`B-${tone}`)).toBeTruthy()
      unmount()
    }
  })
})

describe('LinkCard', () => {
  it('opens an https link in a new tab without leaking the opener', () => {
    render(<LinkCard data={{ title: 'Docs', description: 'Read more', url: 'https://www.acme.test/docs', cta: 'Read docs' }} />)
    const a = screen.getByRole('link')
    expect(a.getAttribute('href')).toBe('https://www.acme.test/docs')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.textContent).toContain('acme.test')
    expect(a.textContent).toContain('Read docs')
  })

  it('renders nothing for a non-https or script URL even if one reaches it', () => {
    for (const url of ['javascript:alert(1)', 'http://acme.test', 'data:text/html,x']) {
      const { container, unmount } = render(<LinkCard data={{ title: 'x', url }} />)
      expect(container.innerHTML, url).toBe('')
      unmount()
    }
  })
})

describe('ContactCard', () => {
  it('builds mailto, tel and https links from the option values', () => {
    render(
      <ContactCard
        data={{
          message: 'Talk to a human',
          options: [
            { kind: 'email', label: 'Email us', value: 'help@acme.test' },
            { kind: 'phone', label: 'Call us', value: '+1 555 010 2030' },
            { kind: 'url', label: 'Support page', value: 'https://acme.test/support' },
          ],
        }}
      />
    )
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      'mailto:help@acme.test',
      'tel:+15550102030',
      'https://acme.test/support',
    ])
    expect(links[2].getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('drops options whose value does not fit their kind and renders nothing if none remain', () => {
    const { container } = render(
      <ContactCard data={{ message: 'm', options: [{ kind: 'email', label: 'x', value: 'javascript:alert(1)' }] }} />
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('CardSkeleton', () => {
  it('is hidden from assistive tech', () => {
    const { container } = render(<CardSkeleton />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})


describe('FollowUpsCard', () => {
  const data = { questions: [{ label: 'How does the AI check its answers?' }, { label: 'Can I run it on my own server?' }] }
  const renderCard = (active: string | null, canReply = true, send = vi.fn()) =>
    render(
      <WidgetActionsProvider value={{ send, canReply, activeFollowUpId: active }}>
        <FollowUpsCard data={data} toolCallId="t1" />
      </WidgetActionsProvider>
    )

  it('draws nothing unless it is the live set of suggestions', () => {
    const { container } = renderCard(null)
    expect(container.firstChild).toBeNull()
    const other = renderCard('some-other-call')
    expect(other.container.firstChild).toBeNull()
  })

  it('draws the questions as buttons with the default lead-in when it is live', () => {
    renderCard('t1')
    expect(screen.getByText('You might also ask')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('uses the assistant’s own lead-in when it gave one', () => {
    render(
      <WidgetActionsProvider value={{ send: vi.fn(), canReply: true, activeFollowUpId: 't1' }}>
        <FollowUpsCard data={{ ...data, prompt: 'Want to know more?' }} toolCallId="t1" />
      </WidgetActionsProvider>
    )
    expect(screen.getByText('Want to know more?')).toBeTruthy()
  })

  it('sends the tapped question exactly as written', async () => {
    const send = vi.fn()
    renderCard('t1', true, send)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Can I run it on my own server?' }))
    expect(send).toHaveBeenCalledExactlyOnceWith('Can I run it on my own server?')
  })

  it('is inert while a reply is still arriving', async () => {
    const send = vi.fn()
    renderCard('t1', false, send)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    await userEvent.setup().click(screen.getAllByRole('button')[0])
    expect(send).not.toHaveBeenCalled()
  })

  it('reads on any brand color: dark text on white with a brand-colored border, like the starter questions', () => {
    renderCard('t1')
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toMatch(/text-gray-800/)
      expect(b.className).toMatch(/bg-white/)
      expect(b.className).toMatch(/border-brand-300/)
      expect(b.className).not.toMatch(/text-brand-/)
    }
  })

  it('is easy to tap and read: at least 44px tall, wrapping, with a visible keyboard focus ring', () => {
    renderCard('t1')
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toMatch(/min-h-11/)
      expect(b.className).toMatch(/break-words/)
      expect(b.className).toMatch(/focus-visible:ring-2/)
    }
  })

  it('shows question text as plain text, never as markup', () => {
    render(
      <WidgetActionsProvider value={{ send: vi.fn(), canReply: true, activeFollowUpId: 't1' }}>
        <FollowUpsCard
          data={{ questions: [{ label: '<img src=x onerror=alert(1)>' }, { label: '**bold?**' }] }}
          toolCallId="t1"
        />
      </WidgetActionsProvider>
    )
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '**bold?**' })).toBeTruthy()
  })
})
