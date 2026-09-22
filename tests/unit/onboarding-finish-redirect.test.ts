import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The "Go live" step's "Go to dashboard" button called completeOnboardingAction
// directly from a client onClick handler and awaited it — but that action
// called redirect('/dashboard'), which throws a special error Next.js only
// intercepts and turns into real navigation when it dispatches a server
// action itself (e.g. a <form action={...}> submission). Called as a bare
// manual function invocation from an event handler, the thrown redirect
// error never reaches the browser: the awaited call never resolves the way
// the UI expected, setLoading(true) never gets reset, and the button hangs
// on "Loading dashboard…" forever. Every other redirect-throwing action in
// this app (logout, invitation accept) is invoked via <form action>, which
// is why only this one manual-call site broke.
//
// Fix: completeOnboardingAction no longer calls redirect() — it does the DB
// writes and returns a plain result; the client navigates with
// router.push('/dashboard') after the awaited call resolves.
//
// Source-file structural assertions — same convention as
// tenant-isolation.test.ts.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('completeOnboardingAction no longer throws via redirect()', () => {
  it('does not import or call redirect from next/navigation', () => {
    const src = read('lib/actions/onboarding.ts')
    expect(src).not.toContain("import { redirect } from 'next/navigation'")
    expect(src).not.toContain("redirect('/dashboard')")
    expect(src).not.toContain("redirect('/login')")
  })

  it('returns a plain result the caller can branch on', () => {
    const src = read('lib/actions/onboarding.ts')
    expect(src).toContain('export async function completeOnboardingAction(): Promise<{ error?: string } | null>')
    expect(src).toContain("return { error: 'Unauthorized' }")
    expect(src).toContain('return null')
  })
})

describe('onboarding wizard navigates client-side after the action resolves', () => {
  it('imports useRouter and calls router.push after a successful finish', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain("useSearchParams, useRouter } from 'next/navigation'")
    expect(src).toContain('const router = useRouter()')
    const finishIdx = src.indexOf('async function handleFinish')
    const pushIdx = src.indexOf("router.push('/dashboard')")
    expect(pushIdx).toBeGreaterThan(finishIdx)
  })

  it('resets loading and surfaces an error if the action fails, instead of hanging', () => {
    const src = read('app/onboarding/wizard.tsx')
    const finishBody = src.slice(
      src.indexOf('async function handleFinish'),
      src.indexOf('const items = [')
    )
    expect(finishBody).toContain('result?.error')
    expect(finishBody).toContain('setLoading(false)')
  })
})
