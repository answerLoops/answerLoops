'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { resetWidgetAppearanceAction, saveWidgetAppearanceAction } from '@/lib/actions/widget'
import {
  DEFAULT_WIDGET_BRAND_COLOR,
  STARTER_QUESTIONS_LIMIT_MESSAGE,
  WIDGET_STARTER_QUESTIONS_MAX,
  WIDGET_STARTER_QUESTION_MAX_CHARS,
  WIDGET_TITLE_MAX_CHARS,
  WIDGET_WELCOME_MAX_CHARS,
  isValidBrandColor,
  normalizeStarterQuestions,
  readableTextColor,
  type WidgetAppearance,
} from '@/lib/widget/appearance'

/**
 * Widget appearance: the chat title, the welcome message, the starter questions and the brand color,
 * shown inside the widget section of Settings. Pro and above; on Standard the
 * controls are shown locked with a short explanation, and the server refuses a
 * save from Standard regardless of what this screen shows.
 */

type FieldName = 'title' | 'welcome' | 'brandColor' | 'starterQuestions'

export function WidgetAppearanceSettings({
  canManage,
  customizationAvailable,
  initialAppearance,
}: {
  canManage: boolean
  customizationAvailable: boolean
  initialAppearance: WidgetAppearance
}) {
  const [saved, setSaved] = useState<WidgetAppearance>(initialAppearance)
  const [title, setTitle] = useState(initialAppearance.title ?? '')
  const [welcome, setWelcome] = useState(initialAppearance.welcome ?? '')
  // One question per line, exactly as typed. Cleaned and limited on save.
  const [starters, setStarters] = useState(initialAppearance.starterQuestions.join('\n'))
  // Off hides the buttons on the live widget and keeps the questions saved.
  const [startersOn, setStartersOn] = useState(initialAppearance.starterEnabled)
  // The hex field holds what is typed, including a half-typed value. An empty
  // field means the answerLoops blue.
  const [color, setColor] = useState(initialAppearance.brandColor ?? '')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: FieldName; error: string } | null>(null)

  const locked = !customizationAvailable
  const editable = canManage && customizationAvailable

  const colorTrimmed = color.trim()
  const colorValid = colorTrimmed === '' || isValidBrandColor(colorTrimmed)
  const previewColor = isValidBrandColor(colorTrimmed) ? colorTrimmed.toLowerCase() : DEFAULT_WIDGET_BRAND_COLOR
  const previewText = readableTextColor(previewColor)

  const startersResult = normalizeStarterQuestions(starters)
  const starterCount = starters.split(/\r?\n/).filter((line) => line.trim() !== '').length
  const startersValid = startersResult.ok

  const unchanged =
    title.trim() === (saved.title ?? '') &&
    welcome.trim() === (saved.welcome ?? '') &&
    colorTrimmed.toLowerCase() === (saved.brandColor ?? '') &&
    startersResult.ok &&
    startersResult.value.join('\n') === saved.starterQuestions.join('\n') &&
    startersOn === saved.starterEnabled

  function applyStored(appearance: WidgetAppearance) {
    // Show what was actually stored, which may differ from what was typed
    // (trimmed, collapsed spaces, lowercased color).
    setSaved(appearance)
    setTitle(appearance.title ?? '')
    setWelcome(appearance.welcome ?? '')
    setStarters(appearance.starterQuestions.join('\n'))
    setStartersOn(appearance.starterEnabled)
    setColor(appearance.brandColor ?? '')
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    setFieldError(null)
    const fd = new FormData()
    fd.set('title', title)
    fd.set('welcome', welcome)
    fd.set('starterQuestions', starters)
    fd.set('starterEnabled', startersOn ? 'true' : 'false')
    fd.set('brandColor', colorTrimmed)
    const result = await saveWidgetAppearanceAction(null, fd)
    if (result.error) {
      if (result.field) setFieldError({ field: result.field, error: result.error })
      else setMessage(result.error)
    } else if (result.appearance) {
      applyStored(result.appearance)
      setMessage('Saved. The widget on your site picks this up within about a minute.')
    }
    setSaving(false)
  }

  async function reset() {
    setResetting(true)
    setMessage(null)
    setFieldError(null)
    const result = await resetWidgetAppearanceAction()
    if (result.error) {
      setMessage(result.error)
    } else if (result.appearance) {
      applyStored(result.appearance)
      setMessage('Back to the answerLoops look. The widget on your site picks this up within about a minute.')
    }
    setResetting(false)
  }

  const nothingCustomized =
    !saved.title &&
    !saved.welcome &&
    !saved.brandColor &&
    saved.starterQuestions.length === 0 &&
    saved.starterEnabled
  const inputClass =
    'w-full rounded border border-gray-200 bg-white px-3 py-2 text-base text-gray-700 disabled:bg-gray-50 disabled:text-gray-400 sm:text-xs'

  return (
    <div className="space-y-3 border-t border-gray-100 pt-3" data-testid="widget-appearance">
      <div>
        <p className="text-xs font-medium text-gray-900">Widget appearance</p>
        <p className="text-[0.6875rem] text-gray-500">
          Make the chat look like your own: the title in its header, the first thing visitors see, and your brand color.
        </p>
      </div>

      {locked && (
        <div
          className="space-y-2 rounded-md border border-brand-100 bg-brand-50 px-3 py-2.5"
          data-testid="widget-appearance-locked"
        >
          <p className="text-[0.6875rem] text-gray-700">
            Customizing the widget is included with Pro and above. On your current plan the chat keeps the answerLoops look.
          </p>
          <Link
            href="/billing"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-xs font-medium text-white hover:bg-brand-700 sm:min-h-8 sm:w-auto"
          >
            Upgrade to customize
          </Link>
        </div>
      )}

      {!canManage && !locked && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600">
          Only owners and admins can change this.
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="widget-title" className="block text-[0.6875rem] font-medium text-gray-700">
          Chat title
        </label>
        <input
          id="widget-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={WIDGET_TITLE_MAX_CHARS}
          disabled={!editable}
          placeholder="Acme Support"
          className={inputClass}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] text-gray-500">
            {title.length} / {WIDGET_TITLE_MAX_CHARS}
          </span>
          {fieldError?.field === 'title' && (
            <p className="break-words text-[0.6875rem] text-red-600">{fieldError.error}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="widget-welcome" className="block text-[0.6875rem] font-medium text-gray-700">
          Welcome message
        </label>
        <textarea
          id="widget-welcome"
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          maxLength={WIDGET_WELCOME_MAX_CHARS}
          rows={3}
          disabled={!editable}
          placeholder="Hi! Ask us anything about your order."
          className={`${inputClass} resize-y`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] text-gray-500">
            {welcome.length} / {WIDGET_WELCOME_MAX_CHARS}
          </span>
          {fieldError?.field === 'welcome' && (
            <p className="break-words text-[0.6875rem] text-red-600">{fieldError.error}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="widget-starter-questions" className="block text-[0.6875rem] font-medium text-gray-700">
          Starter questions
        </label>
        <label
          htmlFor="widget-starter-enabled"
          className={`flex min-h-11 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 ${editable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          <input
            id="widget-starter-enabled"
            type="checkbox"
            role="switch"
            checked={startersOn}
            onChange={(e) => setStartersOn(e.target.checked)}
            disabled={!editable}
            className="h-5 w-5 shrink-0 accent-brand-600"
          />
          <span className="min-w-0 text-xs text-gray-800">
            Show starter questions
            <span className="block text-[0.6875rem] text-gray-500">
              Switch off to hide the buttons without deleting your questions.
            </span>
          </span>
        </label>
        <textarea
          id="widget-starter-questions"
          value={starters}
          onChange={(e) => setStarters(e.target.value)}
          rows={4}
          disabled={!editable}
          placeholder={'How does it work?\nWhat does it cost?'}
          spellCheck={false}
          className={`${inputClass} resize-y`}
        />
        <p className="text-[0.6875rem] text-gray-500">
          One question per line. They appear as buttons under the greeting; tapping one sends it. Up to {WIDGET_STARTER_QUESTIONS_MAX}, {WIDGET_STARTER_QUESTION_MAX_CHARS} characters each.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] text-gray-500">
            {starterCount} / {WIDGET_STARTER_QUESTIONS_MAX} questions
          </span>
          {!startersValid && (
            <p className="break-words text-[0.6875rem] text-red-600">{STARTER_QUESTIONS_LIMIT_MESSAGE}</p>
          )}
          {fieldError?.field === 'starterQuestions' && startersValid && (
            <p className="break-words text-[0.6875rem] text-red-600">{fieldError.error}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="widget-brand-color" className="block text-[0.6875rem] font-medium text-gray-700">
          Brand color
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="Pick a brand color"
            value={previewColor}
            onChange={(e) => setColor(e.target.value)}
            disabled={!editable}
            className="h-11 w-14 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
          />
          <input
            id="widget-brand-color"
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            maxLength={7}
            disabled={!editable}
            placeholder={DEFAULT_WIDGET_BRAND_COLOR}
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={!colorValid}
            className={`${inputClass} min-w-0 flex-1 font-mono sm:max-w-[10rem]`}
          />
        </div>
        <div
          className="mt-2 flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-center text-xs font-medium sm:max-w-xs"
          style={{ backgroundColor: previewColor, color: previewText }}
          data-testid="widget-brand-preview"
        >
          Start chat
        </div>
        <p className="pt-1 text-[0.6875rem] text-gray-500">
          The text on your color is chosen automatically ({previewText === '#ffffff' ? 'white' : 'dark'}) so it is always readable. Leave empty for the answerLoops blue.
        </p>
        {!colorValid && (
          <p className="break-words text-[0.6875rem] text-red-600">Choose a color like #1a73e8.</p>
        )}
        {fieldError?.field === 'brandColor' && colorValid && (
          <p className="break-words text-[0.6875rem] text-red-600">{fieldError.error}</p>
        )}
      </div>

      {editable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            size="sm"
            onClick={save}
            disabled={saving || resetting || unchanged || !colorValid || !startersValid}
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
          >
            {saving ? 'Saving…' : 'Save appearance'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={reset}
            disabled={saving || resetting || nothingCustomized}
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
          >
            {resetting ? 'Resetting…' : 'Reset to default'}
          </Button>
        </div>
      )}
      {message && (
        <p className="break-words text-[0.6875rem] text-gray-600" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
