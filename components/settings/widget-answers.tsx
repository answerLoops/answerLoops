'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { saveWidgetAnswerScopeAction, saveWidgetGuidanceAction } from '@/lib/actions/widget'
import { WIDGET_GUIDANCE_MAX_CHARS, type WidgetAnswerScope } from '@/lib/widget/answer-scope'

/**
 * The two settings that shape what the website chat widget says in the
 * workspace's name: what it may answer from, and an optional note on tone and
 * next steps. Shown inside the widget section of Settings.
 */

const SCOPE_LABELS: Record<WidgetAnswerScope, string> = {
  'knowledge-base-only': 'Only from my knowledge base',
  general: 'My knowledge base, then general knowledge',
}

const SCOPE_HELP: Record<WidgetAnswerScope, string> = {
  'knowledge-base-only':
    'The widget answers only from your published articles. If they do not cover a question it says so and shows the contact details from your articles, or suggests contacting you directly if they list none. It declines requests that are not about your product, and always replies to a greeting or thanks.',
  general:
    'The widget answers from your published articles and, when they do not cover a question, from general knowledge.',
}

// One question your articles don't cover, and roughly what a visitor would see
// under each choice, so an owner can compare them before picking.
const EXAMPLE_QUESTION = 'Can I pay by invoice?'

const SCOPE_EXAMPLE: Record<WidgetAnswerScope, { reply: string; note: string }> = {
  'knowledge-base-only': {
    reply: "I don't have information about paying by invoice. You can reach our team here:",
    note: 'Followed by the email, phone or support page from your articles.',
  },
  general: {
    reply: 'Yes, invoices are usually available on annual plans. Ask your account manager to set it up.',
    note: 'A plausible guess, not taken from your articles, so it can be wrong.',
  },
}

function ScopeExamples({ selected }: { selected: WidgetAnswerScope }) {
  return (
    <div className="space-y-2" data-testid="widget-answer-scope-examples">
      <p className="text-[0.6875rem] text-gray-500">
        Example: a visitor asks &ldquo;{EXAMPLE_QUESTION}&rdquo; and none of your articles cover it.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(['knowledge-base-only', 'general'] as const).map((option) => (
          <div
            key={option}
            data-testid={`widget-answer-scope-example-${option}`}
            data-selected={option === selected}
            className={`min-w-0 rounded-md border px-3 py-2 ${
              option === selected ? 'border-brand-300 bg-brand-50' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <p className="text-[0.6875rem] font-medium text-gray-700">{SCOPE_LABELS[option]}</p>
            <p className="mt-1 break-words text-[0.6875rem] text-gray-700">&ldquo;{SCOPE_EXAMPLE[option].reply}&rdquo;</p>
            <p className="mt-1 break-words text-[0.625rem] text-gray-500">{SCOPE_EXAMPLE[option].note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WidgetAnswersSettings({
  canManage,
  initialScope,
  initialGuidance,
}: {
  canManage: boolean
  initialScope: WidgetAnswerScope
  initialGuidance: string | null
}) {
  const [scope, setScope] = useState<WidgetAnswerScope>(initialScope)
  const [savingScope, setSavingScope] = useState(false)
  const [scopeMsg, setScopeMsg] = useState<string | null>(null)

  const [savedGuidance, setSavedGuidance] = useState(initialGuidance ?? '')
  const [guidance, setGuidance] = useState(initialGuidance ?? '')
  const [savingGuidance, setSavingGuidance] = useState(false)
  const [guidanceMsg, setGuidanceMsg] = useState<string | null>(null)

  async function changeScope(next: WidgetAnswerScope) {
    const previous = scope
    setScope(next)
    setSavingScope(true)
    setScopeMsg(null)
    const fd = new FormData()
    fd.set('scope', next)
    const result = await saveWidgetAnswerScopeAction(null, fd)
    if (result.error) {
      setScope(previous)
      setScopeMsg(result.error)
    } else {
      setScopeMsg('Saved.')
    }
    setSavingScope(false)
  }

  async function saveGuidance() {
    setSavingGuidance(true)
    setGuidanceMsg(null)
    const fd = new FormData()
    fd.set('guidance', guidance)
    const result = await saveWidgetGuidanceAction(null, fd)
    if (result.error) {
      setGuidanceMsg(result.error)
    } else {
      // Show what was actually stored, which may differ from what was typed
      // (trimmed, blank lines collapsed), so the box matches what is in use.
      const stored = result.guidance ?? ''
      setGuidance(stored)
      setSavedGuidance(stored)
      setGuidanceMsg('Saved.')
    }
    setSavingGuidance(false)
  }

  return (
    <>
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <div>
          <p className="text-xs font-medium text-gray-900">What the widget answers from</p>
          <p className="text-[0.6875rem] text-gray-500">{SCOPE_HELP[scope]}</p>
        </div>
        {canManage ? (
          <>
            <select
              value={scope}
              onChange={(e) => changeScope(e.target.value as WidgetAnswerScope)}
              disabled={savingScope}
              aria-label="What the widget answers from"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-base text-gray-700 bg-white sm:w-auto sm:text-xs"
            >
              <option value="knowledge-base-only">{SCOPE_LABELS['knowledge-base-only']}</option>
              <option value="general">{SCOPE_LABELS.general}</option>
            </select>
            {scopeMsg && <p className="break-words text-[0.6875rem] text-gray-600">{scopeMsg}</p>}
          </>
        ) : (
          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600">
            {SCOPE_LABELS[scope]}. Only owners and admins can change this.
          </p>
        )}
        <ScopeExamples selected={scope} />
      </div>

      <div className="space-y-2 border-t border-gray-100 pt-3">
        <div>
          <p className="text-xs font-medium text-gray-900">Guidance for the widget</p>
          <p className="text-[0.6875rem] text-gray-500">
            Optional. A short note on tone and what to suggest next, for example when to mention a trial.
            It shapes how the widget phrases things; it never lets it answer outside your knowledge base.
          </p>
        </div>
        {canManage ? (
          <>
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              maxLength={WIDGET_GUIDANCE_MAX_CHARS}
              rows={5}
              aria-label="Guidance for the widget"
              className="w-full resize-y rounded border border-gray-200 px-3 py-2 text-base text-gray-700 sm:text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={saveGuidance}
                disabled={savingGuidance || guidance.trim() === savedGuidance}
              >
                {savingGuidance ? 'Saving…' : 'Save guidance'}
              </Button>
              <span className="text-[0.6875rem] text-gray-500">
                {guidance.length} / {WIDGET_GUIDANCE_MAX_CHARS}
              </span>
              {guidanceMsg && <p className="break-words text-[0.6875rem] text-gray-600">{guidanceMsg}</p>}
            </div>
          </>
        ) : (
          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600 whitespace-pre-wrap break-words">
            {savedGuidance ? savedGuidance : 'No guidance set.'} Only owners and admins can change this.
          </p>
        )}
      </div>
    </>
  )
}
