'use client'

import Link from 'next/link'
import { useState } from 'react'
import { loginWithProvider } from '@/lib/actions/auth'
import type { SignInProvider, SignInProviderId } from '@/lib/auth/providers'

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

const ICONS: Record<SignInProviderId, () => React.JSX.Element> = {
  google: GoogleIcon,
  github: GitHubIcon,
}

interface Props {
  providers: SignInProvider[]
}

/**
 * The sign-in methods. One action for everyone: a person with an account is
 * signed in, and a new person gets one created and then accepts the terms on
 * the next step (see app/accept-terms), so nothing here needs to know which
 * of the two it is talking to.
 *
 * Only the methods in `providers` are rendered. With none configured the page
 * says so instead of showing a button that cannot work.
 */
export function LoginForm({ providers }: Props) {
  const [pendingId, setPendingId] = useState<SignInProviderId | null>(null)

  if (providers.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">Sign-in is not set up on this deployment.</p>
        <p className="mt-1 text-amber-800">
          If you run this install, add a sign-in method&rsquo;s credentials to your environment.
          The{' '}
          <Link href="/docs/self-hosting/oauth" className="underline underline-offset-2">
            OAuth setup guide
          </Link>{' '}
          lists them.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => {
        const Icon = ICONS[provider.id]
        const pending = pendingId === provider.id
        return (
          <form
            key={provider.id}
            // Set from the submit event, not inside the action: a form action
            // runs as a transition, and React holds state set inside one
            // until it finishes — which for an OAuth redirect is the moment
            // the page is already leaving.
            onSubmit={() => setPendingId(provider.id)}
            action={async () => {
              try {
                await loginWithProvider(provider.id)
              } catch (err) {
                // A failure must not leave every button disabled. The
                // redirect Next throws on success is rethrown untouched.
                setPendingId(null)
                throw err
              }
            }}
          >
            <button
              type="submit"
              disabled={pendingId !== null}
              className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon />
              {pending ? 'Redirecting…' : `Sign in with ${provider.label}`}
            </button>
          </form>
        )
      })}
    </div>
  )
}
