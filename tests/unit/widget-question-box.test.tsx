// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { MESSAGE_MAX_CHARS } from '@/lib/widget/transcript'
import { QUESTION_BOX_MAX_LINES, QuestionBox, hasFinePointer, isSendKey } from '@/app/widget/[widgetToken]/question-box'

/**
 * The widget's question box (app/widget/[widgetToken]/question-box.tsx): when
 * Enter sends and when it does not, when the send button is available, typing
 * while an answer arrives, the length limit, growing to five lines, the sizes
 * that keep phones from zooming, and how a mouse device is detected.
 */

function Harness({ busy = false, initial = '', onSend = vi.fn() }: { busy?: boolean; initial?: string; onSend?: (q: string) => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  return <QuestionBox value={value} onChange={setValue} onSend={onSend} busy={busy} boxRef={ref} />
}

const box = () => screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: 'Send message' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QuestionBox: sending', () => {
  it('sends the question on Enter', async () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await userEvent.setup().type(box(), 'How do I export?{Enter}')
    expect(onSend).toHaveBeenCalledWith('How do I export?')
  })

  it('adds a new line on Shift+Enter instead of sending', async () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await userEvent.setup().type(box(), 'Line one{Shift>}{Enter}{/Shift}Line two')
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe('Line one\nLine two')
  })

  it('does not send on Enter while text is being composed with an input method', () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} initial="にほん" />)
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('にほん')
  })

  it('sends with the button too', async () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} initial="Hello" />)
    await userEvent.setup().click(send())
    expect(onSend).toHaveBeenCalledWith('Hello')
  })

  it('keeps the send button off for an empty or spaces-only question, and Enter does nothing then', async () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    expect(send()).toBeDisabled()
    await userEvent.setup().type(box(), '   {Enter}')
    expect(send()).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
    // Enter on a blank box never adds a line either.
    expect(box().value).toBe('   ')
  })

  it('lets the visitor type while an answer arrives, but holds sending', async () => {
    const onSend = vi.fn()
    render(<Harness busy onSend={onSend} />)
    expect(box()).toBeEnabled()
    await userEvent.setup().type(box(), 'Next question{Enter}')
    expect(box().value).toBe('Next question')
    expect(send()).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('QuestionBox: the box itself', () => {
  it('is a text area with clear names for the box and the button', () => {
    render(<Harness />)
    expect(box().tagName).toBe('TEXTAREA')
    expect(box()).toHaveAttribute('placeholder', 'Ask a question…')
    expect(send()).toHaveAttribute('type', 'submit')
  })

  it('keeps the message length limit, so it stops accepting characters rather than failing on send', () => {
    render(<Harness />)
    expect(box()).toHaveAttribute('maxlength', String(MESSAGE_MAX_CHARS))
  })

  it('grows with the text up to five lines, then scrolls, and shrinks again when cleared', () => {
    const lineHeight = 20
    const padding = 10
    const fakeStyle = () => {
      const values: Record<string, string> = {
        'line-height': `${lineHeight}px`,
        'padding-top': `${padding / 2}px`,
        'padding-bottom': `${padding / 2}px`,
      }
      return {
        lineHeight: values['line-height'],
        paddingTop: values['padding-top'],
        paddingBottom: values['padding-bottom'],
        getPropertyValue: (name: string) => values[name] ?? '',
      } as unknown as CSSStyleDeclaration
    }
    // Only the text area's line height and padding are faked; every other
    // element keeps the real computed style.
    const realStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el instanceof HTMLTextAreaElement ? fakeStyle() : realStyle(el, pseudo)
    )
    let content = 1
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => content * lineHeight + padding)

    const { rerender } = render(<QuestionBoxWith value="one" />)
    expect(box().style.height).toBe(`${lineHeight + padding}px`)
    expect(box().style.overflowY).toBe('hidden')

    content = 3
    rerender(<QuestionBoxWith value={'one\ntwo\nthree'} />)
    expect(box().style.height).toBe(`${3 * lineHeight + padding}px`)

    content = 9
    rerender(<QuestionBoxWith value={'x\n'.repeat(9)} />)
    expect(box().style.height).toBe(`${QUESTION_BOX_MAX_LINES * lineHeight + padding}px`)
    expect(box().style.overflowY).toBe('auto')

    content = 1
    rerender(<QuestionBoxWith value="" />)
    expect(box().style.height).toBe(`${lineHeight + padding}px`)
    expect(box().style.overflowY).toBe('hidden')
  })

  it('uses 16px text and 44px targets on touch screens, and the smaller size only with a mouse', () => {
    render(<Harness />)
    const boxClasses = box().className.split(/\s+/)
    expect(boxClasses).toEqual(expect.arrayContaining(['text-base', 'min-h-11', 'pointer-fine:text-xs']))
    expect(boxClasses).not.toContain('text-xs')
    const buttonClasses = send().className.split(/\s+/)
    expect(buttonClasses).toEqual(expect.arrayContaining(['h-11', 'w-11', 'pointer-fine:h-8', 'pointer-fine:w-8']))
  })

  it('keeps the brand-colored focus ring and send button', () => {
    render(<Harness />)
    expect(box().className).toContain('focus:ring-brand-100')
    expect(send().className).toContain('bg-brand-600')
    expect(send().className).toContain('focus-visible:ring-brand-400')
  })
})

function QuestionBoxWith({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  return <QuestionBox value={value} onChange={() => {}} onSend={() => {}} busy={false} boxRef={ref} />
}

describe('isSendKey', () => {
  const key = (over: Partial<{ key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }>) => ({
    key: over.key ?? 'Enter',
    shiftKey: over.shiftKey ?? false,
    nativeEvent: { isComposing: over.isComposing ?? false, keyCode: over.keyCode ?? 13 },
  }) as unknown as Parameters<typeof isSendKey>[0]

  it('is true only for a plain Enter', () => {
    expect(isSendKey(key({}))).toBe(true)
    expect(isSendKey(key({ shiftKey: true }))).toBe(false)
    expect(isSendKey(key({ isComposing: true }))).toBe(false)
    expect(isSendKey(key({ keyCode: 229 }))).toBe(false)
    expect(isSendKey(key({ key: 'a' }))).toBe(false)
  })
})

describe('hasFinePointer', () => {
  it('asks for a fine pointer, the same test the mouse-sized styles use', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    vi.stubGlobal('matchMedia', matchMedia)
    expect(hasFinePointer()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith('(pointer: fine)')
    vi.unstubAllGlobals()
  })

  it('is false on a touch screen and when the browser cannot say', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(hasFinePointer()).toBe(false)
    vi.stubGlobal('matchMedia', () => {
      throw new Error('unsupported')
    })
    expect(hasFinePointer()).toBe(false)
    vi.unstubAllGlobals()
  })
})
