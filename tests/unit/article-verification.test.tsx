// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ArticleVerification } from '@/types'

/**
 * The verification status and control on each article in the dashboard: the
 * three states shown in words, the optional note, that a failure keeps what was
 * typed and shows the reason, and that success closes the form and tells the
 * page to reload. The server action is faked.
 */

const h = vi.hoisted(() => ({ verifyArticleAction: vi.fn() }))
vi.mock('@/lib/actions/kb', () => ({ verifyArticleAction: h.verifyArticleAction }))

const NEVER: ArticleVerification = { status: 'never', verified_at: null, verified_by: null, verified_by_name: null, note: null }
const VERIFIED: ArticleVerification = {
  status: 'verified',
  verified_at: '2026-10-01T12:00:00.000Z',
  verified_by: 12,
  verified_by_name: 'Dana',
  note: null,
}
const CHANGED: ArticleVerification = { ...VERIFIED, status: 'changed' }

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

async function renderControl(verification: ArticleVerification, onVerified?: () => void) {
  const { ArticleVerificationControl } = await import('@/components/dashboard/article-verification')
  return render(<ArticleVerificationControl articleId={9} verification={verification} onVerified={onVerified} />)
}

const noteBox = () => screen.getByLabelText(/note \(optional\)/i) as HTMLTextAreaElement
const openButton = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  h.verifyArticleAction.mockResolvedValue({ ok: true })
})

describe('ArticleVerificationControl status', () => {
  it('says never verified, in words, for an article nobody has checked', async () => {
    await renderControl(NEVER)
    expect(screen.getByText('Never verified')).toBeTruthy()
    expect(openButton(/^mark as verified$/i)).toBeTruthy()
  })

  it('says who verified it and when, and offers to verify again', async () => {
    await renderControl(VERIFIED)
    expect(screen.getByText(`Verified ${date(VERIFIED.verified_at!)} by Dana`)).toBeTruthy()
    expect(openButton(/^verify again$/i)).toBeTruthy()
  })

  it('says changed since last verified, with the date of the last check', async () => {
    await renderControl(CHANGED)
    expect(screen.getByText(`Changed since last verified (${date(CHANGED.verified_at!)} by Dana)`)).toBeTruthy()
    expect(openButton(/^mark as verified$/i)).toBeTruthy()
  })

  it('leaves out the name when the verifier is gone, and shows a saved note', async () => {
    await renderControl({ ...VERIFIED, verified_by: null, verified_by_name: null, note: 'Checked against v2.4' })
    expect(screen.getByText(`Verified ${date(VERIFIED.verified_at!)}`)).toBeTruthy()
    expect(screen.getByText(/checked against v2\.4/i)).toBeTruthy()
  })

  it('never relies on color alone: every state has a text label', async () => {
    for (const [v, label] of [
      [NEVER, /never verified/i],
      [VERIFIED, /^verified /i],
      [CHANGED, /changed since last verified/i],
    ] as const) {
      const { unmount } = await renderControl(v)
      expect(screen.getByText(label)).toBeTruthy()
      unmount()
    }
  })
})

describe('ArticleVerificationControl form', () => {
  it('starts closed, and opens a note field on click', async () => {
    const user = userEvent.setup()
    await renderControl(NEVER)
    expect(screen.queryByLabelText(/note \(optional\)/i)).toBeNull()
    await user.click(openButton(/^mark as verified$/i))
    expect(noteBox()).toBeTruthy()
    expect(noteBox().maxLength).toBe(500)
  })

  it('submits the article id and the typed note as form fields', async () => {
    const user = userEvent.setup()
    await renderControl(NEVER)
    await user.click(openButton(/^mark as verified$/i))
    await user.type(noteBox(), 'Checked against v2.4')
    await user.click(screen.getAllByRole('button', { name: /^mark as verified$/i }).at(-1)!)

    await waitFor(() => expect(h.verifyArticleAction).toHaveBeenCalledOnce())
    const formData = h.verifyArticleAction.mock.calls[0][1] as FormData
    expect(formData.get('articleId')).toBe('9')
    expect(formData.get('note')).toBe('Checked against v2.4')
  })

  it('can be submitted with no note', async () => {
    const user = userEvent.setup()
    await renderControl(NEVER)
    await user.click(openButton(/^mark as verified$/i))
    await user.click(screen.getAllByRole('button', { name: /^mark as verified$/i }).at(-1)!)
    await waitFor(() => expect(h.verifyArticleAction).toHaveBeenCalledOnce())
    expect((h.verifyArticleAction.mock.calls[0][1] as FormData).get('note')).toBe('')
  })

  it('on success closes the form and tells the page to reload', async () => {
    const user = userEvent.setup()
    const onVerified = vi.fn()
    await renderControl(NEVER, onVerified)
    await user.click(openButton(/^mark as verified$/i))
    await user.type(noteBox(), 'ok')
    await user.click(screen.getAllByRole('button', { name: /^mark as verified$/i }).at(-1)!)

    await waitFor(() => expect(onVerified).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByLabelText(/note \(optional\)/i)).toBeNull())
  })

  it('on failure keeps the typed note, shows the reason, and does not reload the page', async () => {
    const user = userEvent.setup()
    const onVerified = vi.fn()
    h.verifyArticleAction.mockResolvedValue({ error: 'You do not have permission to do that.' })
    await renderControl(NEVER, onVerified)
    await user.click(openButton(/^mark as verified$/i))
    await user.type(noteBox(), 'my note')
    await user.click(screen.getAllByRole('button', { name: /^mark as verified$/i }).at(-1)!)

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not have permission/i)
    expect(noteBox().value).toBe('my note')
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('cancel closes the form and discards the note without calling the server', async () => {
    const user = userEvent.setup()
    await renderControl(NEVER)
    await user.click(openButton(/^mark as verified$/i))
    await user.type(noteBox(), 'draft')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByLabelText(/note \(optional\)/i)).toBeNull()
    await user.click(openButton(/^mark as verified$/i))
    expect(noteBox().value).toBe('')
    expect(h.verifyArticleAction).not.toHaveBeenCalled()
  })
})
