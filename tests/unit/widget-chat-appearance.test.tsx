// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  it('is "<name> Support" when the owner has not set one', async () => {
    await renderChat()
    expect(screen.getByText('Acme Support')).toBeTruthy()
  })

  it('shows the owner’s title instead', async () => {
    await renderChat({ title: 'Acme Help Desk' })
    expect(screen.getByText('Acme Help Desk')).toBeTruthy()
    expect(screen.queryByText('Acme Support')).toBeNull()
  })

  it('renders a title containing markup as text, never as HTML', async () => {
    const { container } = await renderChat({ title: '<img src=x onerror=alert(1)><b>Hi</b>' })
    expect(screen.getByText('<img src=x onerror=alert(1)><b>Hi</b>')).toBeTruthy()
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
