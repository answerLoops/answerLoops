'use client'

import { useState } from 'react'
import { DeflectionConfirmModal } from '@/components/ui/deflection-confirm-modal'

interface ToggleSwitchProps {
  label: string
  defaultChecked?: boolean
  checked?: boolean
  onChange?: (checked: boolean) => void
  name?: string
  disabled?: boolean
  // Platform display name (e.g. "Discord"). When set, flipping this switch
  // ON requires confirming in a modal first — turning OFF never needs
  // confirming, since that's always the safe direction (back to manual
  // review). Omit for switches that aren't gating live customer-facing
  // sends (e.g. nothing in this repo today, kept optional for reuse).
  confirmLabel?: string
}

// A real on/off switch, not a checkbox. Self-manages its own checked state
// (seeded from defaultChecked, or driven externally via checked/onChange for
// a controlled instance like GitHub's inline, no-Edit-step toggle) so it can
// intercept the OFF->ON transition for confirmLabel regardless of which mode
// it's used in. Still renders a plain native checkbox with `name`, so it
// submits through a surrounding <form action={...}> exactly like a checkbox
// would.
export function ToggleSwitch({ label, defaultChecked, checked, onChange, name, disabled, confirmLabel }: ToggleSwitchProps) {
  const isControlled = checked !== undefined
  const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false)
  const [pendingOn, setPendingOn] = useState(false)

  const currentChecked = isControlled ? checked! : internalChecked

  const commit = (next: boolean) => {
    if (isControlled) onChange?.(next)
    else setInternalChecked(next)
  }

  const requestChange = (next: boolean) => {
    if (next && confirmLabel) {
      setPendingOn(true)
      return
    }
    commit(next)
  }

  return (
    <>
      <label className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
          <input
            type="checkbox"
            name={name}
            disabled={disabled}
            checked={currentChecked}
            onChange={(e) => requestChange(e.target.checked)}
            className="peer sr-only"
          />
          <span className="absolute inset-0 rounded-full bg-gray-300 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-emerald-500" />
          <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
        </span>
        <span className="text-xs font-medium text-gray-600">{label}</span>
      </label>
      {confirmLabel && (
        <DeflectionConfirmModal
          open={pendingOn}
          platformLabel={confirmLabel}
          onConfirm={() => {
            setPendingOn(false)
            commit(true)
          }}
          onCancel={() => setPendingOn(false)}
        />
      )}
    </>
  )
}
