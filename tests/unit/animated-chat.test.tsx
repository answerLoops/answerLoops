// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnimatedChat } from '@/components/animated-chat'

describe('support workflow example', () => {
  it('starts with the question and identifies the content as an example', () => {
    render(<AnimatedChat />)
    expect(screen.getByRole('heading', { name: 'A member asks for help' })).toBeInTheDocument()
    expect(screen.getByText('Illustrative example')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1. Question' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('heading', { name: 'A draft your team can review' })).not.toBeInTheDocument()
  })

  it('shows the selected source, draft, and review while removing the previous step', async () => {
    const user = userEvent.setup()
    render(<AnimatedChat />)
    const steps = [
      ['2. Source', 'Find the relevant instructions', 'Source: Invite your team', '/docs/product/team'],
      ['3. Draft', 'A draft your team can review', 'Read the team guide', '/docs/product/team'],
      ['4. Review', 'You choose when replies go out', 'Read about answer review', '/docs/product/ai-deflection'],
    ]
    let previousHeading = 'A member asks for help'
    for (const [button, heading, link, href] of steps) {
      await user.click(screen.getByRole('button', { name: button }))
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: previousHeading })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', href)
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
      expect(screen.getByRole('button', { name: button })).toHaveAttribute('aria-pressed', 'true')
      previousHeading = heading
    }
    expect(screen.getByText(/With automatic replies off, the draft waits for your team/)).toBeInTheDocument()
  })

  it('allows jumping to a later step and returning to the question with the keyboard', async () => {
    const user = userEvent.setup()
    render(<AnimatedChat />)
    await user.click(screen.getByRole('button', { name: '4. Review' }))
    const question = screen.getByRole('button', { name: '1. Question' })
    question.focus()
    await user.keyboard('{Enter}')
    expect(question).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'A member asks for help' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'You choose when replies go out' })).not.toBeInTheDocument()
    const controlledContent = document.getElementById(question.getAttribute('aria-controls')!)
    expect(controlledContent).toHaveAttribute('aria-live', 'polite')
    expect(controlledContent).toContainElement(screen.getByRole('heading', { name: 'A member asks for help' }))
  })
})
