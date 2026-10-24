// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntegrationFlow } from '@/components/docs/integration-flow'

vi.mock('@/components/logo', () => ({
  LogoMark: ({ size }: { size?: number }) => <span data-testid="logo-mark" data-size={size} />,
}))

const base = {
  platform: 'discourse',
  source: { title: 'Your forum', text: 'Members post questions here.' },
  trigger: { title: 'Webhook fires', text: 'Discourse tells answerLoops about a new topic.' },
  steps: [
    { title: 'Search the knowledge base', text: 'Finds matching articles.' },
    { title: 'Draft with AI', text: 'Writes a grounded answer.', logo: 'anthropic' },
    { title: 'Check confidence', text: 'Scores the draft.' },
  ],
  outcomes: [
    { title: 'Posted automatically', text: 'The reply goes out.', tone: 'post' as const },
    { title: 'Held for review', text: 'A person approves first.', tone: 'review' as const },
    { title: 'Escalated', text: 'A person is pulled in.', tone: 'escalate' as const },
    { title: 'Costs one credit', text: 'Billing detail.', tone: 'info' as const },
  ],
  replyLabel: 'Reply posted in the topic',
}

const allTitles = [
  base.source.title,
  base.trigger.title,
  ...base.steps.map((s) => s.title),
  ...base.outcomes.map((o) => o.title),
]

function detail(container: HTMLElement) {
  return container.querySelector('figcaption') as HTMLElement
}

function pressedTitles() {
  return screen
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent)
}

describe('IntegrationFlow', () => {
  it('selects the platform source first and shows its detail', () => {
    const { container } = render(<IntegrationFlow {...base} />)
    expect(screen.getByRole('button', { name: /Your forum/ })).toHaveAttribute('aria-pressed', 'true')
    expect(detail(container)).toHaveTextContent('Your forum. Members post questions here.')
    expect(pressedTitles()).toHaveLength(1)
  })

  it('renders a button for every box with aria-pressed set', () => {
    render(<IntegrationFlow {...base} />)
    expect(screen.getAllByRole('button')).toHaveLength(allTitles.length)
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed')
  })

  it.each(allTitles.slice(1))('clicking "%s" shows its detail and presses only it', async (title) => {
    const user = userEvent.setup()
    const { container } = render(<IntegrationFlow {...base} />)
    const all = [base.source, base.trigger, ...base.steps, ...base.outcomes]
    const item = all.find((i) => i.title === title)!
    const button = screen.getByRole('button', { name: new RegExp(title) })

    await user.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(detail(container)).toHaveTextContent(`${item.title}. ${item.text}`)
    expect(pressedTitles()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Your forum/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('moves the selection when a different box is clicked afterwards', async () => {
    const user = userEvent.setup()
    const { container } = render(<IntegrationFlow {...base} />)
    await user.click(screen.getByRole('button', { name: /Webhook fires/ }))
    await user.click(screen.getByRole('button', { name: /Held for review/ }))
    expect(detail(container)).toHaveTextContent('Held for review. A person approves first.')
    expect(screen.getByRole('button', { name: /Webhook fires/ })).toHaveAttribute('aria-pressed', 'false')
    expect(pressedTitles()).toEqual(['Held for review'])
  })

  it('selects a box when it receives keyboard focus', async () => {
    const user = userEvent.setup()
    const { container } = render(<IntegrationFlow {...base} />)
    await user.tab()
    expect(screen.getByRole('button', { name: /Your forum/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: /Webhook fires/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /Webhook fires/ })).toHaveAttribute('aria-pressed', 'true')
    expect(detail(container)).toHaveTextContent('Discourse tells answerLoops about a new topic.')
    await user.tab()
    expect(detail(container)).toHaveTextContent('Finds matching articles.')
    expect(pressedTitles()).toEqual(['1Search the knowledge base'])
  })

  it('uses the default column headings', () => {
    render(<IntegrationFlow {...base} />)
    expect(screen.getByText('Your community')).toBeInTheDocument()
    expect(screen.getByText('What happens next')).toBeInTheDocument()
  })

  it('uses custom column headings when given', () => {
    render(
      <IntegrationFlow {...base} sourceLabel="Your documentation" outcomesLabel="What it powers" />,
    )
    expect(screen.getByText('Your documentation')).toBeInTheDocument()
    expect(screen.getByText('What it powers')).toBeInTheDocument()
    expect(screen.queryByText('Your community')).not.toBeInTheDocument()
    expect(screen.queryByText('What happens next')).not.toBeInTheDocument()
  })

  it('numbers steps without a logo and shows the logo for steps with one', () => {
    render(<IntegrationFlow {...base} />)
    const steps = screen.getAllByRole('listitem').slice(0, base.steps.length)
    expect(within(steps[0]).getByText('1')).toBeInTheDocument()
    expect(within(steps[0]).queryByRole('img')).toBeNull()
    expect(within(steps[1]).getByRole('img', { name: 'Anthropic logo' })).toBeInTheDocument()
    expect(within(steps[1]).queryByText('2')).toBeNull()
    expect(within(steps[2]).getByText('3')).toBeInTheDocument()
  })

  it('shows the platform logo on the source tile and the return strip', () => {
    render(<IntegrationFlow {...base} />)
    expect(screen.getAllByRole('img', { name: 'Discourse logo' })).toHaveLength(2)
  })

  it('lets sourceLogo override the left tile while the return strip keeps the platform', () => {
    render(<IntegrationFlow {...base} platform="discord" sourceLogo="channels" />)
    const source = screen.getByRole('button', { name: /Your forum/ })
    expect(within(source).getByRole('img', { name: 'Your channels logo' })).toBeInTheDocument()
    expect(within(source).queryByRole('img', { name: 'Discord logo' })).toBeNull()
    expect(screen.getAllByRole('img', { name: 'Discord logo' })).toHaveLength(1)
  })

  it('renders the reply label', () => {
    render(<IntegrationFlow {...base} />)
    expect(screen.getByText('Reply posted in the topic')).toBeInTheDocument()
  })

  it('labels the figure with the platform name', () => {
    render(<IntegrationFlow {...base} platform="Google Chat" />)
    expect(
      screen.getByRole('figure', { name: 'How the Google Chat integration works' }),
    ).toBeInTheDocument()
  })

  it('renders outcomes in order with their titles', () => {
    render(<IntegrationFlow {...base} />)
    const list = screen.getByText('What happens next').parentElement!.querySelector('ul')!
    const titles = within(list)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(titles).toEqual(base.outcomes.map((o) => o.title))
  })

  it('renders steps in order inside the answerLoops pipeline', () => {
    render(<IntegrationFlow {...base} />)
    const ol = document.querySelector('ol')!
    const titles = within(ol)
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/^\d/, ''))
    expect(titles).toEqual(base.steps.map((s) => s.title))
    expect(screen.getByTestId('logo-mark')).toBeInTheDocument()
  })

  it('announces the detail region politely', () => {
    const { container } = render(<IntegrationFlow {...base} />)
    expect(detail(container)).toHaveAttribute('aria-live', 'polite')
  })

  it('defaults an outcome without a tone to the post styling', () => {
    render(
      <IntegrationFlow {...base} outcomes={[{ title: 'Plain outcome', text: 'No tone given.' }]} />,
    )
    const post = screen.getByRole('button', { name: 'Plain outcome' })
    expect(post.className).toContain('border-fd-primary/30')
    expect(post.querySelector('span[aria-hidden]')?.className).toContain('bg-fd-primary')
  })

  it.each([
    ['review', 'border-amber-300', 'bg-amber-500'],
    ['escalate', 'border-orange-300', 'bg-orange-500'],
    ['info', 'border-fd-border', 'bg-fd-ring'],
  ] as const)('applies %s tone styling to an unselected outcome', (tone, border, dot) => {
    render(
      <IntegrationFlow {...base} outcomes={[{ title: 'Toned', text: 'Detail.', tone }]} />,
    )
    const button = screen.getByRole('button', { name: 'Toned' })
    expect(button.className).toContain(border)
    expect(button.querySelector('span[aria-hidden]')?.className).toContain(dot)
  })

  it('drops the tone background when the outcome is selected', async () => {
    const user = userEvent.setup()
    render(
      <IntegrationFlow {...base} outcomes={[{ title: 'Toned', text: 'Detail.', tone: 'review' }]} />,
    )
    const button = screen.getByRole('button', { name: 'Toned' })
    expect(button.className).toContain('bg-amber-50')
    await user.click(button)
    expect(button.className).not.toContain('bg-amber-50')
    expect(button.className).toContain('bg-fd-accent')
  })
})
