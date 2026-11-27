// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ChatMarkdown } from '@/app/widget/[widgetToken]/chat-markdown'
import { copyPlainText, replyPlainText } from '@/lib/widget/reply-plain-text'

/**
 * What a visitor copies from a widget reply (lib/widget/reply-plain-text.ts).
 * Each case renders real Markdown through the widget's own renderer and reads
 * the copy back from the rendered bubble, so the copy is checked against what
 * is actually on screen.
 */

function copyOf(markdown: string): string {
  const { container } = render(<ChatMarkdown text={markdown} />)
  return replyPlainText(container)
}

describe('replyPlainText', () => {
  it('separates paragraphs with a blank line', () => {
    expect(copyOf('First paragraph.\n\nSecond paragraph.')).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('keeps the words of bold, italic and inline code and drops their markup', () => {
    expect(copyOf('Press **Save**, then run `npm install` and wait *a moment*.')).toBe(
      'Press Save, then run npm install and wait a moment.'
    )
  })

  it('puts each bullet on its own line with a dash', () => {
    expect(copyOf('Before you start:\n\n- an account\n- an **API key**\n- ten minutes')).toBe(
      'Before you start:\n\n- an account\n- an API key\n- ten minutes'
    )
  })

  it('numbers ordered items, starting where the list starts', () => {
    expect(copyOf('1. Open Settings\n2. Choose Export\n3. Download')).toBe('1. Open Settings\n2. Choose Export\n3. Download')
    expect(copyOf('3. Third\n4. Fourth')).toBe('3. Third\n4. Fourth')
  })

  it('indents a nested list under its item', () => {
    expect(copyOf('- Billing\n  - Invoices\n  - Refunds\n- Support')).toBe('- Billing\n  - Invoices\n  - Refunds\n- Support')
  })

  it('keeps a loose list (items with blank lines between) one item per line', () => {
    expect(copyOf('- First\n\n- Second')).toBe('- First\n- Second')
  })

  it('copies a link as its words followed by its address', () => {
    expect(copyOf('See [the export guide](https://docs.example.com/export) for details.')).toBe(
      'See the export guide (https://docs.example.com/export) for details.'
    )
  })

  it('copies a bare address once, not twice', () => {
    expect(copyOf('Go to <https://docs.example.com/export>.')).toBe('Go to https://docs.example.com/export.')
  })

  it('copies only the words of a link the bubble does not render as a link', () => {
    expect(copyOf('Click [here](javascript:alert(1)) now.')).toBe('Click here now.')
  })

  it('joins a soft line break with a space, as the bubble shows it', () => {
    expect(copyOf('Line one\nLine two')).toBe('Line one Line two')
  })

  it('keeps a hard line break as a new line', () => {
    expect(copyOf('Line one  \nLine two')).toBe('Line one\nLine two')
  })

  it('mixes paragraphs and lists in reading order', () => {
    expect(copyOf('To export:\n\n1. Open Settings\n2. Choose Export\n\nThe file arrives by email.')).toBe(
      'To export:\n\n1. Open Settings\n2. Choose Export\n\nThe file arrives by email.'
    )
  })

  it('has no leading or trailing whitespace', () => {
    expect(copyOf('\n\nJust this.\n\n')).toBe('Just this.')
  })
})

describe('copyPlainText', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else delete (navigator as { clipboard?: unknown }).clipboard
    vi.restoreAllMocks()
  })

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
  }

  function setExecCommand(result: boolean | 'throw') {
    const fn = vi.fn(() => {
      if (result === 'throw') throw new Error('blocked')
      return result
    })
    Object.defineProperty(document, 'execCommand', { value: fn, configurable: true })
    return fn
  }

  it('uses the Clipboard API when it works, without the fallback', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })
    const exec = setExecCommand(true)
    expect(await copyPlainText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(exec).not.toHaveBeenCalled()
  })

  it('falls back to the copy command when the Clipboard API refuses', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) })
    const exec = setExecCommand(true)
    expect(await copyPlainText('hello')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('falls back to the copy command when there is no Clipboard API', async () => {
    setClipboard(undefined)
    const exec = setExecCommand(true)
    expect(await copyPlainText('hello')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('reports failure when neither method works, and leaves nothing behind on the page', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) })
    setExecCommand(false)
    expect(await copyPlainText('hello')).toBe(false)
    setExecCommand('throw')
    expect(await copyPlainText('hello')).toBe(false)
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
