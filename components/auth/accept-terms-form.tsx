'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { acceptTerms } from '@/lib/actions/terms'

interface Props {
  /** Where to go once the terms are accepted; validated again on the server. */
  callbackUrl?: string
  /** Origin that serves the terms and privacy pages, or '' for this origin. */
  legalBaseUrl?: string
  /** Whether accepting also starts a free trial, which changes the button's wording. */
  startsTrial: boolean
}

/**
 * The step after signing in for someone who has not yet accepted the terms.
 *
 * Both boxes start unchecked. The terms are required and hold the button; the
 * product-updates box is a separate, optional choice. The server enforces the
 * terms regardless of what this form does.
 */
export function AcceptTermsForm({ callbackUrl, legalBaseUrl = '', startsTrial }: Props) {
  const [terms, setTerms] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await acceptTerms({ terms, marketing, callbackUrl })
        if (result?.error) setError(result.error)
      } catch (err) {
        // The redirect Next throws on success is rethrown untouched.
        if (err && typeof err === 'object' && 'digest' in err) throw err
        setError('Something went wrong. Try again.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <label className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-900"
          />
          <span>
            I agree to the{' '}
            <Link href={`${legalBaseUrl}/terms`} className="font-medium text-slate-900 underline underline-offset-2">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href={`${legalBaseUrl}/privacy`} className="font-medium text-slate-900 underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-900"
          />
          <span>
            It&rsquo;s OK to email me product updates and tips. Optional, and you can unsubscribe any time.
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!terms || pending}
        className="w-full rounded-full bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'One moment…' : startsTrial ? 'Start my free trial' : 'Continue'}
      </button>
    </div>
  )
}
