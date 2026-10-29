import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { Logo } from '@/components/logo'
import { AcceptTermsForm } from '@/components/auth/accept-terms-form'
import { getDb } from '@/lib/db/drizzle'
import { users } from '@/lib/db/schema'
import { safeNextPath } from '@/lib/auth/next-path'
import { TRIAL_DAYS, getDeploymentMode } from '@/lib/billing/plans'
import { MARKETING_URL, marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'One last step — answerLoops',
  robots: { index: false, follow: false },
}

/**
 * Where a new account accepts the terms, right after signing in with Google.
 *
 * Signing in is a single action for everyone, so this is the first place a new
 * person can be asked. The access gate in auth.ts sends anyone without a
 * recorded acceptance here, and this page sends them on once they have one.
 */
export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const session = await auth()
  const { callbackUrl } = await searchParams
  if (!session?.user) redirect('/login')

  const [user] = await getDb()
    .select({ termsAcceptedAt: users.termsAcceptedAt })
    .from(users)
    .where(eq(users.id, Number(session.user.id)))
    .limit(1)
  if (user?.termsAcceptedAt) redirect(safeNextPath(callbackUrl))

  // Self-hosted installs have no trial to start.
  const startsTrial = getDeploymentMode() === 'cloud'

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f3] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] sm:px-8 sm:py-10">
        <div className="mb-6 flex justify-center">
          <Logo width={110} />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-950">
          {startsTrial ? 'One last step' : 'Before you continue'}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {startsTrial
            ? `Accept our terms and your ${TRIAL_DAYS}-day free trial starts straight away, with every feature and no card.`
            : 'Please accept our terms to continue.'}
        </p>
        <div className="mt-7">
          <AcceptTermsForm
            callbackUrl={callbackUrl}
            legalBaseUrl={marketingSiteEnabled() ? MARKETING_URL : ''}
            startsTrial={startsTrial}
          />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Signed in as {session.user.email}.{' '}
          <a href="/api/auth/signout" className="underline underline-offset-2 hover:text-slate-600">
            Not you?
          </a>
        </p>
      </div>
    </div>
  )
}
