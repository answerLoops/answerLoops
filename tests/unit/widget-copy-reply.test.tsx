// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { ChatMarkdown } from '@/app/widget/[widgetToken]/chat-markdown'
import { COPY_CONFIRM_MS, CopyReply } from '@/app/widget/[widgetToken]/copy-reply'

/**
 * The Copy action under a widget reply (app/widget/[widgetToken]/copy-reply.tsx):
 * what lands on the clipboard, the Copied / Couldn't copy confirmation and when
 * it ends, the announcement for screen readers, keyboard use, and the classes
 * that hide it on mouse devices until the reply is hovered or focused.
 */

function Reply({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="group">
      <div ref={ref}>
        <ChatMarkdown text={text} />
      </div>
      <CopyReply bubbleRef={ref} />
    </div>
  )
}

let writeText: ReturnType<typeof vi.fn>

function mockClipboard() {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

/** userEvent.setup() installs its own clipboard, so the mock goes in after it. */
function setupUser() {
  const user = userEvent.setup()
  mockClipboard()
  return user
}

beforeEach(() => {
  writeText = vi.fn(async () => {})
  mockClipboard()
})

afterEach(() => {
  vi.useRealTimers()
})

const button = () => screen.getByRole('button', { name: 'Copy reply' })
const announcement = () => document.querySelector('output[aria-live="polite"]')!

describe('CopyReply', () => {
  it('is a real button named "Copy reply" that reads "Copy"', () => {
    render(<Reply text="Hello" />)
    expect(button().tagName).toBe('BUTTON')
    expect(button()).toHaveAttribute('type', 'button')
    expect(button()).toHaveTextContent('Copy')
  })

  it('copies the reply as plain readable text, never its Markdown', async () => {
    render(<Reply text={'To export:\n\n1. Open **Settings**\n2. Run `export`\n\nSee [the guide](https://docs.example.com/x).'} />)
    await setupUser().click(button())
    expect(writeText).toHaveBeenCalledWith(
      'To export:\n\n1. Open Settings\n2. Run export\n\nSee the guide (https://docs.example.com/x).'
    )
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).not.toMatch(/[*`]|\]\(/)
  })

  it('reads "Copied" and announces it, then goes back to "Copy" after about two seconds', async () => {
    vi.useFakeTimers()
    render(<Reply text="Hello" />)
    await act(async () => {
      fireEvent.click(button())
    })
    expect(button()).toHaveTextContent('Copied')
    expect(announcement()).toHaveTextContent('Reply copied')

    act(() => {
      vi.advanceTimersByTime(COPY_CONFIRM_MS - 1)
    })
    expect(button()).toHaveTextContent('Copied')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(button()).toHaveTextContent(/^Copy$/)
    expect(announcement()).toHaveTextContent('')
    expect(COPY_CONFIRM_MS).toBe(2000)
  })

  it('says "Couldn\'t copy" when the browser blocks copying, instead of failing silently', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true })
    render(<Reply text="Hello" />)
    await setupUser().click(button())
    expect(button()).toHaveTextContent("Couldn't copy")
    expect(announcement()).toHaveTextContent("Couldn't copy the reply")
  })

  it('works from the keyboard with Enter and with Space', async () => {
    render(<Reply text="Hello" />)
    const user = setupUser()
    await user.tab()
    expect(button()).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(writeText).toHaveBeenCalledTimes(1)
    await user.keyboard(' ')
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('on a mouse device starts hidden and shows on hover or keyboard focus within the reply; touch keeps it visible', () => {
    render(<Reply text="Hello" />)
    const cls = button().className.split(/\s+/)
    // Hidden only under pointer-fine, so touch screens always see it.
    expect(cls).toContain('pointer-fine:opacity-0')
    expect(cls).not.toContain('opacity-0')
    expect(cls).toEqual(expect.arrayContaining(['pointer-fine:group-hover:opacity-100', 'pointer-fine:group-focus-within:opacity-100']))
    // 44px tall on touch; smaller only with a fine pointer.
    expect(cls).toContain('min-h-11')
    expect(cls).toContain('pointer-fine:min-h-7')
    // Opacity only (never display), so the conversation does not shift; no fade with reduced motion.
    expect(cls).toContain('transition-opacity')
    expect(cls).toContain('motion-reduce:transition-none')
    expect(cls.some((c) => /(^|:)(hidden|invisible)$/.test(c))).toBe(false)
    // Brand colors on hover and focus.
    expect(cls).toEqual(expect.arrayContaining(['hover:bg-brand-50', 'focus-visible:ring-brand-400']))
  })

  it('stays visible while it shows its confirmation, even without hover', async () => {
    render(<Reply text="Hello" />)
    await setupUser().click(button())
    expect(button().className.split(/\s+/)).not.toContain('pointer-fine:opacity-0')
  })

  it('sends nothing anywhere when copying', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<Reply text="Hello" />)
    await setupUser().click(button())
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
