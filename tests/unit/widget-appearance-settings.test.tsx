// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetAppearanceSettings } from '@/components/settings/widget-appearance'

/**
 * The widget appearance section in Settings → Widget: what a Pro owner can
 * change, what a Standard owner sees locked, what a member only reads, and how
 * errors, counters and reset behave.
 */

const h = vi.hoisted(() => ({
  saveWidgetAppearanceAction: vi.fn(),
  resetWidgetAppearanceAction: vi.fn(),
}))

vi.mock('@/lib/actions/widget', () => ({
  saveWidgetAppearanceAction: h.saveWidgetAppearanceAction,
  resetWidgetAppearanceAction: h.resetWidgetAppearanceAction,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const NONE = { title: null, welcome: null, brandColor: null, starterQuestions: [] as string[], starterEnabled: true, followUpsEnabled: true }

beforeEach(() => {
  vi.clearAllMocks()
})

const title = () => screen.getByLabelText('Chat title') as HTMLInputElement
const welcome = () => screen.getByLabelText('Welcome message') as HTMLTextAreaElement
const starters = () => screen.getByLabelText('Starter questions') as HTMLTextAreaElement
const toggle = () => screen.getByRole('switch', { name: /show starter questions/i }) as HTMLInputElement
const followUps = () => screen.getByRole('switch', { name: /suggest follow-up questions/i }) as HTMLInputElement
const colorText = () => screen.getByLabelText('Brand color') as HTMLInputElement
const colorPicker = () => screen.getByLabelText('Pick a brand color') as HTMLInputElement
const save = () => screen.getByRole('button', { name: /save appearance|saving/i }) as HTMLButtonElement
const reset = () => screen.getByRole('button', { name: /reset to default|resetting/i }) as HTMLButtonElement
const preview = () => screen.getByTestId('widget-brand-preview')

describe('the color preview', () => {
  it('is labelled as a preview and is not exposed as a clickable control', () => {
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ title: null, welcome: null, brandColor: '#0f7f93', starterQuestions: [], starterEnabled: true, followUpsEnabled: true }}
      />
    )
    expect(screen.getByText('Preview')).toBeTruthy()
    const box = preview()
    expect(box.textContent).toBe('Sample button')
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.tagName).toBe('DIV')
    expect(screen.queryByRole('button', { name: /start chat|sample button/i })).toBeNull()
  })
})

describe('a Pro or above owner or admin', () => {
  it('sees the saved values and no lock', () => {
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ title: 'Acme Help', welcome: 'Hello there', brandColor: '#ffd60a', starterQuestions: [], starterEnabled: true, followUpsEnabled: true }}
      />
    )
    expect(title().value).toBe('Acme Help')
    expect(welcome().value).toBe('Hello there')
    expect(colorText().value).toBe('#ffd60a')
    expect(colorPicker().value).toBe('#ffd60a')
    expect(screen.queryByTestId('widget-appearance-locked')).toBeNull()
    expect(title().disabled).toBe(false)
  })

  it('counts characters against the limits', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(screen.getByText('0 / 60')).toBeTruthy()
    expect(screen.getByText('0 / 200')).toBeTruthy()
    await userEvent.type(title(), 'Acme')
    expect(screen.getByText('4 / 60')).toBeTruthy()
    expect(title().maxLength).toBe(60)
    expect(welcome().maxLength).toBe(200)
  })

  it('keeps Save off until something changes, then sends the form and shows what was stored', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({
      appearance: { title: 'Acme Help', welcome: null, brandColor: '#ffd60a', starterQuestions: [], starterEnabled: true, followUpsEnabled: true },
    })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(save().disabled).toBe(true)
    await userEvent.type(title(), '  Acme   Help ')
    await userEvent.type(colorText(), '#FFD60A')
    expect(save().disabled).toBe(false)
    await userEvent.click(save())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/within about a minute/))
    const fd = h.saveWidgetAppearanceAction.mock.calls[0][1] as FormData
    expect(fd.get('title')).toBe('  Acme   Help ')
    expect(fd.get('brandColor')).toBe('#FFD60A')
    // The boxes show what the server stored: cleaned and lowercased.
    expect(title().value).toBe('Acme Help')
    expect(colorText().value).toBe('#ffd60a')
    expect(save().disabled).toBe(true)
  })

  it('keeps the color box and the color picker in step', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(colorPicker().value).toBe('#2563eb')
    await userEvent.type(colorText(), '#0b1f4d')
    expect(colorPicker().value).toBe('#0b1f4d')
  })

  it('shows the text color it will use on the chosen color, and says so', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(colorText(), '#ffd60a')
    expect(preview().style.backgroundColor).toBe('#ffd60a')
    expect(preview().style.color).toBe('#111827')
    expect(screen.getByText(/chosen automatically \(dark\)/)).toBeTruthy()
    await userEvent.clear(colorText())
    await userEvent.type(colorText(), '#0b1f4d')
    expect(preview().style.color).toBe('#ffffff')
    expect(screen.getByText(/chosen automatically \(white\)/)).toBeTruthy()
  })

  it('refuses a color that is not a full hex value, before anything is sent', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(colorText(), '#fff')
    expect(screen.getByText('Choose a color like #1a73e8.')).toBeTruthy()
    expect(colorText().getAttribute('aria-invalid')).toBe('true')
    expect(save().disabled).toBe(true)
    expect(h.saveWidgetAppearanceAction).not.toHaveBeenCalled()
  })

  it('shows the server’s message next to the field it belongs to', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({
      field: 'title',
      error: 'Keep the chat title under 60 characters',
    })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(title(), 'Acme')
    await userEvent.click(save())
    await waitFor(() => expect(screen.getByText('Keep the chat title under 60 characters')).toBeTruthy())
  })

  it('shows a general failure, such as a refused plan, as a message', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({ error: 'Customizing the widget is included with Pro and above.' })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(title(), 'Acme')
    await userEvent.click(save())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Pro and above/))
  })

  it('resets to the answerLoops look and empties the boxes', async () => {
    h.resetWidgetAppearanceAction.mockResolvedValue({ appearance: NONE })
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ title: 'Acme Help', welcome: 'Hello', brandColor: '#ffd60a', starterQuestions: [], starterEnabled: true, followUpsEnabled: true }}
      />
    )
    await userEvent.click(reset())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Back to the answerLoops look/))
    expect(title().value).toBe('')
    expect(welcome().value).toBe('')
    expect(colorText().value).toBe('')
    expect(h.resetWidgetAppearanceAction).toHaveBeenCalledTimes(1)
  })

  it('has nothing to reset when nothing is customized', () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(reset().disabled).toBe(true)
  })

  it('gives the buttons a comfortable height on a phone', () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(save().className).toMatch(/min-h-11/)
    expect(reset().className).toMatch(/min-h-11/)
    expect(save().className).toMatch(/\bw-full\b/)
  })
})

describe('starter questions', () => {
  it('shows the saved questions one per line, with a live count out of four', async () => {
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ ...NONE, starterQuestions: ['How does it work?', 'What does it cost?'] }}
      />
    )
    expect(starters().value).toBe('How does it work?\nWhat does it cost?')
    expect(screen.getByText('2 / 4 questions')).toBeTruthy()
    await userEvent.type(starters(), '{Enter}Is there a free trial?')
    expect(screen.getByText('3 / 4 questions')).toBeTruthy()
  })

  it('does not count blank lines, and keeps Save off until something changes', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(screen.getByText('0 / 4 questions')).toBeTruthy()
    await userEvent.type(starters(), '{Enter}{Enter}')
    expect(screen.getByText('0 / 4 questions')).toBeTruthy()
    expect(save().disabled).toBe(true)
    await userEvent.type(starters(), 'How does it work?')
    expect(save().disabled).toBe(false)
  })

  it('sends them with the form and shows exactly what the server stored', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({
      appearance: { ...NONE, starterQuestions: ['How does it work?', 'What does it cost?'] },
    })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(starters(), ' How does it work? {Enter}{Enter}What does it cost?{Enter}how does it work?')
    await userEvent.click(save())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/within about a minute/))
    const fd = h.saveWidgetAppearanceAction.mock.calls[0][1] as FormData
    expect(fd.get('starterQuestions')).toBe(' How does it work? \n\nWhat does it cost?\nhow does it work?')
    expect(starters().value).toBe('How does it work?\nWhat does it cost?')
    expect(save().disabled).toBe(true)
  })

  it('blocks Save and says why when there are more than four or one is too long', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(starters(), 'a{Enter}b{Enter}c{Enter}d{Enter}e')
    expect(screen.getByText('Use up to 4 starter questions, 80 characters each.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    await userEvent.clear(starters())
    await userEvent.type(starters(), 'q'.repeat(81))
    expect(screen.getByText('Use up to 4 starter questions, 80 characters each.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    await userEvent.clear(starters())
    await userEvent.type(starters(), 'q'.repeat(80))
    expect(save().disabled).toBe(false)
  })

  it('shows the server’s message next to the box', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({
      field: 'starterQuestions',
      error: 'Use up to 4 starter questions, 80 characters each.',
    })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(starters(), 'How does it work?')
    await userEvent.click(save())
    await waitFor(() =>
      expect(screen.getByText('Use up to 4 starter questions, 80 characters each.')).toBeTruthy()
    )
  })

  it('is emptied by Reset to default', async () => {
    h.resetWidgetAppearanceAction.mockResolvedValue({ appearance: NONE })
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ ...NONE, starterQuestions: ['How does it work?'] }}
      />
    )
    expect(reset().disabled).toBe(false)
    await userEvent.click(reset())
    await waitFor(() => expect(starters().value).toBe(''))
    expect(h.resetWidgetAppearanceAction).toHaveBeenCalledTimes(1)
  })

  it('is locked on a plan without customization and read-only for a member', () => {
    const { unmount } = render(
      <WidgetAppearanceSettings canManage customizationAvailable={false} initialAppearance={NONE} />
    )
    expect(starters().disabled).toBe(true)
    unmount()
    render(
      <WidgetAppearanceSettings
        canManage={false}
        customizationAvailable
        initialAppearance={{ ...NONE, starterQuestions: ['How does it work?'] }}
      />
    )
    expect(starters().disabled).toBe(true)
    expect(starters().value).toBe('How does it work?')
  })
})

describe('the starter questions switch', () => {
  const QS = ['How does it work?', 'What does it cost?']

  it('is on by default, labelled, and a comfortable size to tap', () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(toggle().checked).toBe(true)
    expect(toggle().closest('label')?.className).toMatch(/min-h-11/)
    expect(screen.getByText(/without deleting your questions/i)).toBeTruthy()
  })

  it('shows the saved state, and still lets the questions be edited while off', async () => {
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ ...NONE, starterQuestions: QS, starterEnabled: false, followUpsEnabled: true }}
      />
    )
    expect(toggle().checked).toBe(false)
    expect(starters().disabled).toBe(false)
    expect(starters().value).toBe(QS.join('\n'))
    await userEvent.type(starters(), '{Enter}Is there a trial?')
    expect(screen.getByText('3 / 4 questions')).toBeTruthy()
  })

  it('turns Save on when flipped, sends the choice with the form, and shows what was stored', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({
      appearance: { ...NONE, starterQuestions: QS, starterEnabled: false, followUpsEnabled: true },
    })
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ ...NONE, starterQuestions: QS, starterEnabled: true, followUpsEnabled: true }}
      />
    )
    expect(save().disabled).toBe(true)
    await userEvent.click(toggle())
    expect(toggle().checked).toBe(false)
    expect(save().disabled).toBe(false)
    await userEvent.click(save())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/within about a minute/))
    const fd = h.saveWidgetAppearanceAction.mock.calls[0][1] as FormData
    expect(fd.get('starterEnabled')).toBe('false')
    expect(fd.get('starterQuestions')).toBe(QS.join('\n'))
    expect(toggle().checked).toBe(false)
    expect(save().disabled).toBe(true)
  })

  it('sends "true" when on', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({ appearance: { ...NONE, starterQuestions: QS } })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(starters(), QS[0])
    await userEvent.click(save())
    await waitFor(() => expect(h.saveWidgetAppearanceAction).toHaveBeenCalled())
    expect((h.saveWidgetAppearanceAction.mock.calls[0][1] as FormData).get('starterEnabled')).toBe('true')
  })

  it('is back on, with the questions cleared, after Reset to default', async () => {
    h.resetWidgetAppearanceAction.mockResolvedValue({ appearance: NONE })
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ ...NONE, starterQuestions: QS, starterEnabled: false, followUpsEnabled: true }}
      />
    )
    expect(reset().disabled).toBe(false)
    await userEvent.click(reset())
    await waitFor(() => expect(toggle().checked).toBe(true))
    expect(starters().value).toBe('')
  })

  it('counts as something to reset when it is the only thing switched off', () => {
    render(
      <WidgetAppearanceSettings
        canManage
        customizationAvailable
        initialAppearance={{ ...NONE, starterEnabled: false, followUpsEnabled: true }}
      />
    )
    expect(reset().disabled).toBe(false)
  })

  it('is locked on a plan without customization and for a member', () => {
    const { unmount } = render(
      <WidgetAppearanceSettings canManage customizationAvailable={false} initialAppearance={NONE} />
    )
    expect(toggle().disabled).toBe(true)
    unmount()
    render(<WidgetAppearanceSettings canManage={false} customizationAvailable initialAppearance={NONE} />)
    expect(toggle().disabled).toBe(true)
  })
})

describe('the follow-up suggestions switch', () => {
  it('is on by default, labelled, and a comfortable size to tap', () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(followUps().checked).toBe(true)
    expect(followUps().getAttribute('aria-checked')).toBe('true')
    expect(followUps().closest('label')?.className).toMatch(/min-h-11/)
    expect(screen.getByText(/questions the visitor might ask next, taken from your knowledge base/i)).toBeTruthy()
  })

  it('turns Save on when flipped, sends the choice with the form, and shows what was stored', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({ appearance: { ...NONE, followUpsEnabled: false } })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    expect(save().disabled).toBe(true)
    await userEvent.click(followUps())
    expect(followUps().checked).toBe(false)
    expect(followUps().getAttribute('aria-checked')).toBe('false')
    expect(save().disabled).toBe(false)
    await userEvent.click(save())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/within about a minute/))
    expect((h.saveWidgetAppearanceAction.mock.calls[0][1] as FormData).get('followUpsEnabled')).toBe('false')
    expect(followUps().checked).toBe(false)
    expect(save().disabled).toBe(true)
  })

  it('sends "true" when on', async () => {
    h.saveWidgetAppearanceAction.mockResolvedValue({ appearance: { ...NONE, title: 'Acme' } })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.type(title(), 'Acme')
    await userEvent.click(save())
    await waitFor(() => expect(h.saveWidgetAppearanceAction).toHaveBeenCalled())
    expect((h.saveWidgetAppearanceAction.mock.calls[0][1] as FormData).get('followUpsEnabled')).toBe('true')
  })

  it('is independent of the starter questions switch', async () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} />)
    await userEvent.click(followUps())
    expect(toggle().checked).toBe(true)
    await userEvent.click(toggle())
    expect(followUps().checked).toBe(false)
  })

  it('is back on after Reset to default', async () => {
    h.resetWidgetAppearanceAction.mockResolvedValue({ appearance: NONE })
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={{ ...NONE, followUpsEnabled: false }} />)
    expect(reset().disabled).toBe(false)
    await userEvent.click(reset())
    await waitFor(() => expect(followUps().checked).toBe(true))
  })

  it('counts as something to reset when it is the only thing switched off', () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable initialAppearance={{ ...NONE, followUpsEnabled: false }} />)
    expect(reset().disabled).toBe(false)
  })

  it('is locked on a plan without customization and for a member', () => {
    const { unmount } = render(<WidgetAppearanceSettings canManage customizationAvailable={false} initialAppearance={NONE} />)
    expect(followUps().disabled).toBe(true)
    unmount()
    render(<WidgetAppearanceSettings canManage={false} customizationAvailable initialAppearance={NONE} />)
    expect(followUps().disabled).toBe(true)
  })
})

describe('an owner on a plan without customization', () => {
  it('sees the controls locked, with a plain explanation and an upgrade link', () => {
    render(<WidgetAppearanceSettings canManage customizationAvailable={false} initialAppearance={NONE} />)
    const locked = screen.getByTestId('widget-appearance-locked')
    expect(locked.textContent).toMatch(/Pro and above/)
    const upgrade = screen.getByRole('link', { name: /upgrade to customize/i })
    expect(upgrade.getAttribute('href')).toBe('/billing')
    expect(title().disabled).toBe(true)
    expect(welcome().disabled).toBe(true)
    expect(colorText().disabled).toBe(true)
    expect(colorPicker().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /save appearance/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /reset to default/i })).toBeNull()
  })
})

describe('a member who is not an owner or admin', () => {
  it('only reads the values and is told who can change them', () => {
    render(
      <WidgetAppearanceSettings
        canManage={false}
        customizationAvailable
        initialAppearance={{ title: 'Acme Help', welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true }}
      />
    )
    expect(screen.getByText(/only owners and admins can change this/i)).toBeTruthy()
    expect(title().value).toBe('Acme Help')
    expect(title().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /save appearance/i })).toBeNull()
  })
})

describe('the logo control', () => {
  const LOGO = `/api/widget/logo/${'a'.repeat(48)}?v=0123456789abcdef`
  const NEW_LOGO = `/api/widget/logo/${'a'.repeat(48)}?v=fedcba9876543210`
  const fetchMock = vi.fn()
  const fileInput = () => screen.getByTestId('widget-logo-file') as HTMLInputElement
  const previewImg = () => screen.getByTestId('widget-logo-preview').querySelector('img') as HTMLImageElement
  const file = (name = 'logo.png', type = 'image/png', bytes = 2000) => new File([new Uint8Array(bytes)], name, { type })
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  function renderPro(initialLogoUrl: string | null = null, props: Partial<React.ComponentProps<typeof WidgetAppearanceSettings>> = {}) {
    return render(
      <WidgetAppearanceSettings canManage customizationAvailable initialAppearance={NONE} initialLogoUrl={initialLogoUrl} {...props} />
    )
  }

  it('shows the answerLoops mark and an Upload logo button when there is no logo', () => {
    renderPro()
    expect(previewImg().getAttribute('src')).toContain('logo.png')
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('shows the current logo, with Replace and Remove, when there is one', () => {
    renderPro(LOGO)
    expect(previewImg().getAttribute('src')).toBe(LOGO)
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('only offers PNG, JPEG and WebP in the file chooser', () => {
    renderPro()
    expect(fileInput().accept).toBe('image/png,image/jpeg,image/webp')
  })

  it('uploads the chosen file straight away and shows the new logo', async () => {
    fetchMock.mockResolvedValue(json({ logoUrl: NEW_LOGO }))
    renderPro()
    await userEvent.upload(fileInput(), file())
    await waitFor(() => expect(previewImg().getAttribute('src')).toBe(NEW_LOGO))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData }]
    expect(url).toBe('/api/settings/widget-logo')
    expect(init.method).toBe('POST')
    expect((init.body.get('file') as File).name).toBe('logo.png')
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Logo saved/)
  })

  it('shows the server\'s plain message when the file is refused, and keeps the old logo', async () => {
    fetchMock.mockResolvedValue(json({ error: 'That file is not a PNG, JPEG or WebP image.' }, 400))
    renderPro(LOGO)
    await userEvent.setup({ applyAccept: false }).upload(fileInput(), file('logo.svg', 'image/svg+xml'))
    expect((await screen.findByRole('alert')).textContent).toBe('That file is not a PNG, JPEG or WebP image.')
    expect(previewImg().getAttribute('src')).toBe(LOGO)
  })

  it('refuses a file over 1 MB on the spot, without sending it', async () => {
    renderPro()
    await userEvent.upload(fileInput(), file('big.png', 'image/png', 1024 * 1024 + 1))
    expect((await screen.findByRole('alert')).textContent).toBe('The image is larger than 1 MB.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so, in plain words, when the connection fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    renderPro()
    await userEvent.upload(fileInput(), file())
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save that logo/i)
    expect(previewImg().getAttribute('src')).toContain('logo.png')
  })

  it('cannot be pressed twice while an upload is running', async () => {
    let finish: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPro(LOGO)
    await userEvent.upload(fileInput(), file())
    const busy = await screen.findByRole('button', { name: 'Uploading…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true)
    finish(json({ logoUrl: NEW_LOGO }))
    await waitFor(() => expect(previewImg().getAttribute('src')).toBe(NEW_LOGO))
  })

  it('removes the logo and goes back to the answerLoops mark', async () => {
    fetchMock.mockResolvedValue(json({ logoUrl: null }))
    renderPro(LOGO)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(previewImg().getAttribute('src')).toContain('logo.png'))
    expect((fetchMock.mock.calls[0] as [string, { method: string }])[1].method).toBe('DELETE')
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Logo removed/)
  })

  it('keeps the logo and says so when removing fails', async () => {
    fetchMock.mockResolvedValue(json({ error: 'We could not remove that logo. Try again.' }, 500))
    renderPro(LOGO)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect((await screen.findByRole('alert')).textContent).toBe('We could not remove that logo. Try again.')
    expect(previewImg().getAttribute('src')).toBe(LOGO)
  })

  it('is disabled, and sends nothing, on a plan without customization', async () => {
    renderPro(null, { customizationAvailable: false })
    expect((screen.getByRole('button', { name: 'Upload logo' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fileInput().disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is disabled for a member who is not an owner or admin', () => {
    renderPro(LOGO, { canManage: false })
    expect((screen.getByRole('button', { name: 'Replace logo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('goes away with Reset to default, and Reset is available when the logo is the only thing set', async () => {
    h.resetWidgetAppearanceAction.mockResolvedValue({ appearance: NONE })
    renderPro(LOGO)
    expect(reset().disabled).toBe(false)
    await userEvent.click(reset())
    await waitFor(() => expect(previewImg().getAttribute('src')).toContain('logo.png'))
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('explains what it does, with the limits', () => {
    renderPro()
    expect(screen.getByText(/PNG, JPEG or WebP, up to 1 MB/)).toBeTruthy()
    expect(screen.getByText(/crop it to a square/)).toBeTruthy()
  })
})
