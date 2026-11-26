'use client'

import { useState, useEffect } from 'react'
import { getWidgetTokenAction, regenerateWidgetTokenAction, saveWidgetOriginsAction, saveWidgetLeadCaptureModeAction, saveWidgetSlugAction } from '@/lib/actions/widget'
import type { WidgetLeadCaptureMode } from '@/lib/widget/lead-capture'
import type { WidgetAnswerScope } from '@/lib/widget/answer-scope'
import { WidgetAnswersSettings } from '@/components/settings/widget-answers'
import { WidgetDailyLimitSettings } from '@/components/settings/widget-daily-limit'
import { WidgetAppearanceSettings } from '@/components/settings/widget-appearance'
import { EMPTY_WIDGET_APPEARANCE, type WidgetAppearance } from '@/lib/widget/appearance'
import { Button } from '@/components/ui/button'
import { WidgetBrandingUpsell } from '@/components/billing/widget-branding-upsell'

export function WidgetSection() {
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rotating, setRotating] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  // Server actions are the authoritative gate; this only decides whether to
  // render controls a member would be rejected for using. Defaults to false so
  // they never flash in before the role is known.
  const [canManage, setCanManage] = useState(false)
  const [origins, setOrigins] = useState('')
  const [savedOrigins, setSavedOrigins] = useState('')
  const [savingOrigins, setSavingOrigins] = useState(false)
  const [originsMsg, setOriginsMsg] = useState<string | null>(null)
  const [leadCaptureMode, setLeadCaptureMode] = useState<WidgetLeadCaptureMode>('on-failure')
  const [savingLeadCaptureMode, setSavingLeadCaptureMode] = useState(false)
  const [leadCaptureMsg, setLeadCaptureMsg] = useState<string | null>(null)
  const [answerScope, setAnswerScope] = useState<WidgetAnswerScope>('knowledge-base-only')
  const [guidance, setGuidance] = useState<string | null>(null)
  const [dailyLimit, setDailyLimit] = useState<number | null>(null)
  const [dailyCeiling, setDailyCeiling] = useState<number | null>(null)
  const [appearance, setAppearance] = useState<WidgetAppearance>(EMPTY_WIDGET_APPEARANCE)
  const [customizationAvailable, setCustomizationAvailable] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  // The saved slug is what the snippet carries; the draft is what's in the box.
  const [slug, setSlug] = useState<string | null>(null)
  const [slugDraft, setSlugDraft] = useState('')
  const [savingSlug, setSavingSlug] = useState(false)
  const [slugMsg, setSlugMsg] = useState<string | null>(null)

  async function changeLeadCaptureMode(mode: WidgetLeadCaptureMode) {
    const previous = leadCaptureMode
    setLeadCaptureMode(mode)
    setSavingLeadCaptureMode(true)
    setLeadCaptureMsg(null)
    const fd = new FormData()
    fd.set('mode', mode)
    const result = await saveWidgetLeadCaptureModeAction(null, fd)
    if (result.error) {
      setLeadCaptureMode(previous)
      setLeadCaptureMsg(result.error)
    } else {
      setLeadCaptureMsg('Saved.')
    }
    setSavingLeadCaptureMode(false)
  }

  async function saveOrigins() {
    setSavingOrigins(true)
    setOriginsMsg(null)
    const fd = new FormData()
    fd.set('origins', origins)
    const result = await saveWidgetOriginsAction(null, fd)
    if (result.error) {
      setOriginsMsg(result.error)
    } else {
      const normalized = (result.origins ?? []).join('\n')
      setOrigins(normalized)
      setSavedOrigins(normalized)
      setOriginsMsg(
        normalized
          ? `Saved. The widget will load on ${result.origins!.length} domain${result.origins!.length === 1 ? '' : 's'}.`
          : 'Saved. With no domains listed the widget will not load on any site.'
      )
    }
    setSavingOrigins(false)
  }

  async function saveSlug() {
    setSavingSlug(true)
    setSlugMsg(null)
    const fd = new FormData()
    fd.set('slug', slugDraft)
    const result = await saveWidgetSlugAction(null, fd)
    if (result.error) {
      setSlugMsg(result.error)
    } else {
      const saved = result.slug ?? null
      setSlug(saved)
      setSlugDraft(saved ?? '')
      setSlugMsg(
        saved
          ? 'Saved. Use the updated snippet above on your site.'
          : 'Cleared. Any page still using the old name will stop loading the widget.'
      )
    }
    setSavingSlug(false)
  }

  useEffect(() => {
    let cancelled = false
    getWidgetTokenAction()
      .then((result) => {
        if (cancelled) return
        if (result.token) {
          setToken(result.token)
          setExpiresAt(result.expiresAt ?? null)
          setCanManage(result.canManage === true)
          setOrigins(result.allowedOrigins ?? '')
          setSavedOrigins(result.allowedOrigins ?? '')
          if (result.leadCaptureMode) setLeadCaptureMode(result.leadCaptureMode)
          if (result.answerScope) setAnswerScope(result.answerScope)
          setGuidance(result.guidance ?? null)
          setDailyLimit(result.dailyAnswerLimit ?? null)
          setDailyCeiling(result.dailyAnswerCeiling ?? null)
          setAppearance(result.appearance ?? EMPTY_WIDGET_APPEARANCE)
          setCustomizationAvailable(result.customizationAvailable === true)
          setLogoUrl(result.logoUrl ?? null)
          setSlug(result.slug ?? null)
          setSlugDraft(result.slug ?? '')
        }
        setLoading(false)
      })
      .catch(() => {
        // Leaves token null, which the render below already treats as
        // "failed to load" — without this, a rejected promise (rather than
        // a resolved-but-empty result) left `loading` true forever: a
        // permanently stuck spinner, never the controls below it with a
        // default an admin could mistake for the saved value.
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function regenerate() {
    setRotating(true)
    setConfirmRotate(false)
    const result = await regenerateWidgetTokenAction()
    if (result.token) { setToken(result.token); setExpiresAt(result.expiresAt ?? null) }
    setRotating(false)
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  // The slug survives token rotation; the token does not. Prefer the slug once
  // one is set so the pasted snippet never needs editing again.
  const embedCode = token
    ? `<script src="${baseUrl}/widget.js" data-widget-id="${slug ?? token}"></script>`
    : ''

  // Read once on mount so rendering stays pure; the count only needs to be
  // right as of when the page was opened.
  const [now] = useState(() => Date.now())
  const daysLeft = expiresAt
    ? Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000)
    : null

  const expiringSoon = daysLeft !== null && daysLeft <= 14

  function copyEmbed() {
    if (!embedCode) return
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <p className="text-xs text-gray-600">
        Add a chat widget to any website. Visitors can ask questions and get answers from your knowledge base automatically.
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2">
        <p className="min-w-0 flex-1 text-xs text-gray-700">
          The widget answers from your published articles. See which questions they cover, and test a question.
        </p>
        <a href="/kb?tab=coverage" className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
          See what the assistant knows →
        </a>
      </div>

      <WidgetBrandingUpsell />

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !token ? (
        <p className="text-sm text-red-500">Failed to load widget token.</p>
      ) : (
        <div className="space-y-3">
          {expiringSoon && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-800 font-medium">
                Token expires in {daysLeft} day{daysLeft === 1 ? '' : 's'} — regenerate it before it expires or the widget will stop working.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Paste this before <code className="text-brand-600">&lt;/body&gt;</code></p>
            <div className="relative">
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 font-mono overflow-x-auto whitespace-pre-wrap break-all">{embedCode}</pre>
              <button
                onClick={copyEmbed}
                className="absolute top-2 right-2 rounded px-2 py-1 text-[0.625rem] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <a
                href={`/widget/${token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
              >
                Preview widget ↗
              </a>
              {expiresAt && (
                <p className={`text-[0.625rem] ${expiringSoon ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                  Expires {new Date(expiresAt).toLocaleDateString()} ({daysLeft}d left)
                </p>
              )}
            </div>

            {!canManage ? null : confirmRotate ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="w-full text-xs text-red-600 sm:w-auto">
                  {slug ? 'Embeds that use your public name keep working.' : 'Old token breaks immediately.'}
                </p>
                <Button size="sm" variant="danger" onClick={regenerate} disabled={rotating}>
                  {rotating ? 'Rotating…' : 'Confirm rotate'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmRotate(true)} disabled={rotating}>
                Regenerate token
              </Button>
            )}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <div>
              <p className="text-xs font-medium text-gray-900">Public name</p>
              <p className="text-[0.6875rem] text-gray-500">
                A stable name for the embed snippet, so you can regenerate the token without editing
                your site. Like the token, it is visible in your page source.
              </p>
            </div>
            {canManage ? (
              <>
                <input
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="none"
                  maxLength={40}
                  placeholder="acme-support"
                  aria-label="Public name"
                  className="w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs sm:w-72"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={saveSlug} disabled={savingSlug || slugDraft.trim() === (slug ?? '')}>
                    {savingSlug ? 'Saving…' : 'Save name'}
                  </Button>
                  {slugMsg && <p className="text-[0.6875rem] text-gray-600">{slugMsg}</p>}
                </div>
              </>
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 break-words px-3 py-2 text-[0.6875rem] text-gray-600">
                {slug ? `Public name: ${slug}.` : 'No public name set.'} Only owners and admins can change this.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <div>
              <p className="text-xs font-medium text-gray-900">Allowed domains</p>
              <p className="text-[0.6875rem] text-gray-500">
                The embed token is visible in your page source, so anyone can copy it. List the domains
                you embed on — the widget will not load anywhere else. Subdomains are included. The
                preview link works without setup while you are signed in.
              </p>
            </div>
            {canManage ? (
              <>
                <textarea
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={'example.com\ndocs.example.com'}
                  className="w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={saveOrigins} disabled={savingOrigins || origins === savedOrigins}>
                    {savingOrigins ? 'Saving…' : 'Save domains'}
                  </Button>
                  {originsMsg && <p className="min-w-0 basis-full break-words text-[0.6875rem] text-gray-600 [overflow-wrap:anywhere] sm:basis-auto">{originsMsg}</p>}
                </div>
              </>
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600">
                {savedOrigins
                  ? `Allowed on: ${savedOrigins.split('\n').join(', ')}`
                  : 'No domains listed — the widget will not load on any site yet.'}
                {' '}Only owners and admins can change this.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <div>
              <p className="text-xs font-medium text-gray-900">Ask for an email</p>
              <p className="text-[0.6875rem] text-gray-500">
                When the widget collects a visitor&apos;s email address.
              </p>
            </div>
            {canManage ? (
              <>
                <select
                  value={leadCaptureMode}
                  onChange={(e) => changeLeadCaptureMode(e.target.value as WidgetLeadCaptureMode)}
                  disabled={savingLeadCaptureMode}
                  aria-label="Ask for an email"
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 bg-white sm:w-auto"
                >
                  <option value="on-failure">Only if it can&apos;t help — after an unanswered question</option>
                  <option value="up-front">Before the conversation starts</option>
                  <option value="off">Never</option>
                </select>
                {leadCaptureMsg && <p className="text-[0.6875rem] text-gray-600">{leadCaptureMsg}</p>}
              </>
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600">
                {leadCaptureMode === 'on-failure'
                  ? 'Only asked after an unanswered question.'
                  : leadCaptureMode === 'up-front'
                    ? 'Asked before the conversation starts.'
                    : 'Never asked.'}
                {' '}Only owners and admins can change this.
              </p>
            )}
          </div>

          {/* Keyed on what was loaded so the controls start from the saved
              values: the section renders before the token request returns. */}
          <WidgetAnswersSettings
            key={`${answerScope}:${guidance ?? ''}`}
            canManage={canManage}
            initialScope={answerScope}
            initialGuidance={guidance}
          />

          {/* Keyed the same way, for the same reason. */}
          {dailyCeiling !== null && (
            <WidgetDailyLimitSettings
              key={`${dailyLimit ?? ''}:${dailyCeiling}`}
              canManage={canManage}
              initialLimit={dailyLimit}
              ceiling={dailyCeiling}
            />
          )}

          {/* Keyed the same way, for the same reason. */}
          <WidgetAppearanceSettings
            key={`${customizationAvailable}:${appearance.title ?? ''}:${appearance.welcome ?? ''}:${appearance.brandColor ?? ''}:${appearance.starterQuestions.join('|')}:${appearance.starterEnabled}:${appearance.followUpsEnabled}`}
            canManage={canManage}
            customizationAvailable={customizationAvailable}
            initialAppearance={appearance}
            initialLogoUrl={logoUrl}
          />
        </div>
      )}
    </div>
  )
}
