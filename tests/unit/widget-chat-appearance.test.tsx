// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { brandPalette } from '@/lib/widget/appearance'

/**
 * What a workspace's own title, welcome message and brand color do to the chat
 * panel. The CopilotKit runtime is faked the way widget-chat-component.test.tsx
 * does it: only WidgetChat's own rendering is under test here.
 */

vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))

const fake = vi.hoisted(() => ({
  agent: {
    messages: [] as unknown[],
    addMessage: vi.fn(),
    runAgent: vi.fn(async () => {}),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  },
}))

vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: fake.agent, isReady: true }),
  useRenderTool: () => {},
  useRenderToolCall: () => () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
})

async function renderChat(props: Partial<React.ComponentProps<typeof import('@/app/widget/[widgetToken]/widget-chat').WidgetChat>> = {}) {
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  return render(
    <WidgetChat
      widgetToken={'a'.repeat(48)}
      renderToken="t"
      orgName="Acme"
      showBranding
      isSelfPreview={false}
      leadCaptureMode="off"
      {...props}
    />
  )
}

describe('the chat title', () => {
  // The title is drawn twice in an empty chat: in the header, and as the
  // heading of the welcome card.
  it('is "<name> Support" when the owner has not set one', async () => {
    await renderChat()
    expect(screen.getAllByText('Acme Support').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the owner’s title instead', async () => {
    await renderChat({ title: 'Acme Help Desk' })
    expect(screen.getAllByText('Acme Help Desk').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Acme Support')).toBeNull()
  })

  it('renders a title containing markup as text, never as HTML', async () => {
    const { container } = await renderChat({ title: '<img src=x onerror=alert(1)><b>Hi</b>' })
    expect(screen.getAllByText('<img src=x onerror=alert(1)><b>Hi</b>').length).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('the welcome message', () => {
  it('keeps today’s greeting by default', async () => {
    await renderChat()
    expect(screen.getByText('👋 Hi! How can I help you today?')).toBeTruthy()
  })

  it('shows the owner’s message in the empty chat', async () => {
    await renderChat({ welcome: 'Hi! Ask us anything about your order.' })
    expect(screen.getByText('Hi! Ask us anything about your order.')).toBeTruthy()
    expect(screen.queryByText('👋 Hi! How can I help you today?')).toBeNull()
  })

  it('shows it on the email screen as well, when the email comes first', async () => {
    await renderChat({ welcome: 'Welcome to Acme', leadCaptureMode: 'up-front' })
    expect(screen.getByRole('heading', { name: 'Welcome to Acme' })).toBeTruthy()
    expect(screen.queryByText('👋 Hi! How can we help?')).toBeNull()
  })

  it('keeps the default email-screen heading when none is set', async () => {
    await renderChat({ leadCaptureMode: 'up-front' })
    expect(screen.getByRole('heading', { name: '👋 Hi! How can we help?' })).toBeTruthy()
  })

  it('renders markup in the message as text', async () => {
    const { container } = await renderChat({ welcome: '<script>alert(1)</script>' })
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
  })
})

describe('the brand color', () => {
  it('sets the brand tokens and the readable text color on the panel root', async () => {
    const palette = brandPalette('#ffd60a')
    const { container } = await renderChat({ brandStyle: palette })
    const root = container.querySelector('[data-brand-colored="true"]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.style.getPropertyValue('--brand-600')).toBe('#ffd60a')
    expect(root.style.getPropertyValue('--brand-on')).toBe('#111827')
    expect(root.style.getPropertyValue('--brand-700')).toBe(palette['--brand-700'])
  })

  it('sets nothing for a workspace without a brand color, so the answerLoops blue applies', async () => {
    const { container } = await renderChat()
    expect(container.querySelector('[data-brand-colored]')).toBeNull()
    expect(container.innerHTML).not.toContain('--brand-')
  })

  it('draws the text on brand-colored controls with the readable-color class, not fixed white', async () => {
    const user = userEvent.setup()
    const { container } = await renderChat({ leadCaptureMode: 'up-front', brandStyle: brandPalette('#ffd60a') })
    const start = screen.getByRole('button', { name: 'Start chat' })
    expect(start.className).toContain('bg-brand-600')
    expect(start.className).toContain('text-on-brand')
    expect(start.className).not.toContain('text-white')
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    const send = container.querySelector('button[type="submit"]') as HTMLElement
    expect(send.className).toContain('text-on-brand')
    expect(send.className).not.toContain('text-white')
  })
})

describe('the first screen', () => {
  it('is a welcome card with a larger avatar and the greeting as its heading, without repeating the title', async () => {
    await renderChat({ title: 'Acme Help Desk', welcome: 'Ask us anything.' })
    const card = screen.getByTestId('welcome-card')
    expect(card.className).toContain('from-brand-50')
    const heading = card.querySelector('h2') as HTMLElement
    expect(heading.textContent).toBe('Ask us anything.')
    expect(heading.className).toContain('text-base')
    expect(heading.className).toContain('font-semibold')
    // The title lives in the header; the card does not say it a second time.
    expect(card.textContent).not.toContain('Acme Help Desk')
    expect(screen.getAllByText('Acme Help Desk')).toHaveLength(1)
  })

  it('shows the default greeting as the heading when none is set', async () => {
    await renderChat({ title: 'Acme Help Desk' })
    const heading = screen.getByTestId('welcome-card').querySelector('h2') as HTMLElement
    expect(heading.textContent).toBe('👋 Hi! How can I help you today?')
  })

  it('does not explain where answers come from', async () => {
    await renderChat()
    expect(screen.getByTestId('welcome-card').textContent).not.toMatch(/docs|knowledge base|source/i)
  })

  it('goes away once the conversation has started', async () => {
    fake.agent.messages = [{ id: 'm1', role: 'user', content: 'hello' }]
    await renderChat()
    expect(screen.queryByTestId('welcome-card')).toBeNull()
    fake.agent.messages = []
  })
})

describe('starter questions', () => {
  const QUESTIONS = ['How does it work?', 'What does it cost?']

  beforeEach(() => {
    fake.agent.messages = []
    fake.agent.addMessage.mockImplementation((m: unknown) => {
      fake.agent.messages.push(m)
    })
  })

  it('shows each as a button under the greeting', async () => {
    await renderChat({ starterQuestions: QUESTIONS })
    const group = screen.getByTestId('starter-questions')
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((b) => b.textContent)).toEqual(QUESTIONS)
    for (const b of buttons) {
      expect(b.getAttribute('type')).toBe('button')
      expect(b.className).toContain('min-h-11')
      expect(b.className).toContain('focus-visible:ring-2')
    }
  })

  it('shows none when there are none', async () => {
    await renderChat({ starterQuestions: [] })
    expect(screen.queryByTestId('starter-questions')).toBeNull()
    cleanup()
    await renderChat()
    expect(screen.queryByTestId('starter-questions')).toBeNull()
  })

  it('sends exactly that text once, the way a typed question is sent', async () => {
    const user = userEvent.setup()
    await renderChat({ starterQuestions: QUESTIONS })
    await user.click(screen.getByRole('button', { name: 'What does it cost?' }))
    expect(fake.agent.addMessage).toHaveBeenCalledTimes(1)
    expect(fake.agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'What does it cost?' })
    )
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(1)
    expect(fake.agent.runAgent).toHaveBeenCalledWith({
      forwardedProps: expect.objectContaining({ widgetToken: 'a'.repeat(48), renderToken: 't' }),
    })
  })

  it('disappears once the question has been sent', async () => {
    const user = userEvent.setup()
    await renderChat({ starterQuestions: QUESTIONS })
    await user.click(screen.getByRole('button', { name: 'How does it work?' }))
    expect(screen.queryByTestId('starter-questions')).toBeNull()
    expect(screen.queryByTestId('welcome-card')).toBeNull()
  })

  it('stays hidden behind the email screen until the visitor gets past it', async () => {
    const user = userEvent.setup()
    await renderChat({ starterQuestions: QUESTIONS, leadCaptureMode: 'up-front' })
    expect(screen.queryByTestId('starter-questions')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByTestId('starter-questions')).toBeTruthy()
  })

  it('is drawn as text, never as HTML', async () => {
    const { container } = await renderChat({ starterQuestions: ['<img src=x onerror=alert(1)>'] })
    expect(screen.getByRole('button', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('the welcome card logo', () => {
  it('is the answerLoops mark by default', async () => {
    await renderChat()
    const img = screen.getByTestId('welcome-avatar').querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toContain('logo.png')
  })

  it('shows a workspace logo when one is passed, in the same round frame', async () => {
    await renderChat({ logoUrl: 'https://cdn.example.com/acme.png' })
    const avatar = screen.getByTestId('welcome-avatar')
    const img = avatar.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/acme.png')
    expect(avatar.className).toContain('rounded-full')
  })

  it('falls back to the default mark for anything that is not a path on this site or an https address', async () => {
    for (const bad of ['javascript:alert(1)', 'http://insecure.example.com/a.png', '//evil.example.com/a.png', 'data:image/png;base64,AAAA', '']) {
      const { unmount } = await renderChat({ logoUrl: bad })
      const img = screen.getByTestId('welcome-avatar').querySelector('img') as HTMLImageElement
      expect(img.getAttribute('src'), bad).toContain('logo.png')
      unmount()
    }
  })
})

describe('with the starter questions switched off', () => {
  it('shows the welcome card and no buttons, because the panel is given none', async () => {
    await renderChat({ starterQuestions: [] })
    expect(screen.getByTestId('welcome-card')).toBeTruthy()
    expect(screen.queryByTestId('starter-questions')).toBeNull()
  })
})


describe('a workspace logo in the chat', () => {
  const LOGO = `/api/widget/logo/${'a'.repeat(48)}?v=0123456789abcdef`
  const srcOf = (id: string) => (screen.getByTestId(id).querySelector('img') as HTMLImageElement).getAttribute('src') ?? ''

  it('shows it in the header, as well as on the welcome card', async () => {
    await renderChat({ logoUrl: LOGO })
    expect(srcOf('header-avatar')).toBe(LOGO)
    expect(srcOf('welcome-avatar')).toBe(LOGO)
  })

  it('shows the answerLoops mark in both places without one', async () => {
    await renderChat()
    expect(srcOf('header-avatar')).toContain('logo.png')
    expect(srcOf('welcome-avatar')).toContain('logo.png')
  })

  it('shows it beside every assistant reply, and not beside the visitor\'s own messages', async () => {
    fake.agent.messages = [
      { id: 'u1', role: 'user', content: 'How does it work?' },
      { id: 'a1', role: 'assistant', content: 'It answers from your docs.' },
      { id: 'u2', role: 'user', content: 'And the price?' },
      { id: 'a2', role: 'assistant', content: 'See the pricing page.' },
    ]
    await renderChat({ logoUrl: LOGO })
    const replies = screen.getAllByTestId('reply-avatar')
    expect(replies).toHaveLength(2)
    for (const reply of replies) expect(reply.querySelector('img')?.getAttribute('src')).toBe(LOGO)
    fake.agent.messages = []
  })

  it('shows it on the email screen too', async () => {
    await renderChat({ logoUrl: LOGO, leadCaptureMode: 'up-front' })
    expect(srcOf('welcome-avatar')).toBe(LOGO)
  })

  it('falls back to the answerLoops mark, in every place, when the image cannot load', async () => {
    await renderChat({ logoUrl: LOGO })
    const headerImg = screen.getByTestId('header-avatar').querySelector('img') as HTMLImageElement
    fireEvent.error(headerImg)
    expect(srcOf('header-avatar')).toContain('logo.png')
    const welcomeImg = screen.getByTestId('welcome-avatar').querySelector('img') as HTMLImageElement
    fireEvent.error(welcomeImg)
    expect(srcOf('welcome-avatar')).toContain('logo.png')
  })

  it('draws no logo for an address that is not a path on this site or an https address', async () => {
    for (const bad of ['javascript:alert(1)', '//evil.example.com/a.png', 'data:image/png;base64,AAAA', 'http://insecure.example.com/a.png']) {
      const { unmount } = await renderChat({ logoUrl: bad })
      expect(srcOf('header-avatar'), bad).toContain('logo.png')
      unmount()
    }
  })

  it('draws the logo as a picture only, with no text for a screen reader to read twice', async () => {
    await renderChat({ logoUrl: LOGO })
    const img = screen.getByTestId('header-avatar').querySelector('img') as HTMLImageElement
    expect(img.getAttribute('alt')).toBe('')
  })
})
