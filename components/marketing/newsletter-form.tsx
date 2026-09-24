'use client'
import { useId, useState } from 'react'

type Status = 'idle' | 'loading' | 'success' | 'error'

export function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const inputId = useId()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setErrorMessage(
          res.status === 429
            ? "You're doing that a bit fast. Try again in a minute."
            : 'That email address didn\'t look right. Double-check it and try again.',
        )
        return
      }
      setStatus('success')
      setEmail('')
      void data
    } catch {
      setStatus('error')
      setErrorMessage('Something went wrong. Try again in a moment.')
    }
  }

  if (status === 'success') {
    return (
      <p className="marketing-newsletter-success" role="status">
        You&apos;re on the list — new posts land in your inbox.
      </p>
    )
  }

  return (
    <form
      className="marketing-newsletter-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <label htmlFor={inputId} className="sr-only">
        Email address
      </label>
      <input
        id={inputId}
        type="email"
        name="email"
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === 'loading'}
        className="marketing-newsletter-input"
      />
      <button
        type="submit"
        className="marketing-button"
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
      </button>
      {status === 'error' && (
        <p className="marketing-newsletter-error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  )
}
