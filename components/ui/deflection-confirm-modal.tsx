'use client'

import { Button } from '@/components/ui/button'

export function DeflectionConfirmModal({
  open,
  platformLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  platformLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pt-36 pb-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Turn on Automatic Deflections for {platformLabel}?</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              The AI will start posting high-confidence answers directly to <span className="font-medium text-slate-700">{platformLabel}</span> —
              live, with no human reviewing them first. Low-confidence answers still always go to a human, unaffected
              by this. You can turn this back off at any time.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={onConfirm}>
            Turn on
          </Button>
        </div>
      </div>
    </div>
  )
}
