'use client'

import { useState } from 'react'

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const [kind, setKind] = useState<'success' | 'error'>('success')
  const show = (msg: string, toastKind: 'success' | 'error' = 'success') => {
    setMessage(msg)
    setKind(toastKind)
    // Longer messages (e.g. a failure explaining what to do next) need more
    // than a flash to read — scale the visible time with length instead of a
    // flat 3s.
    const durationMs = Math.max(3000, Math.min(10000, 1500 + msg.length * 60))
    setTimeout(() => setMessage(null), durationMs)
  }
  return { toastMessage: message, toastKind: kind, showToast: show }
}

export function Toast({ message, kind = 'success' }: { message: string; kind?: 'success' | 'error' }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl animate-in fade-in slide-in-from-bottom-2">
      {kind === 'error' ? (
        <svg className="h-4 w-4 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {message}
    </div>
  )
}

export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="font-mono text-gray-700 truncate text-right">{value}</span>
    </div>
  )
}

