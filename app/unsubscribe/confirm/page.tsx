import crypto from 'crypto'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/logo'
import { confirmSubscription } from '@/lib/db/queries/newsletter'
import { verifyNewsletterConfirmToken } from '@/lib/newsletter/confirm-token'
import { sendNewsletterConfirmation } from '@/lib/email/send'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Lives under /unsubscribe so it shares that route's existing public and
// marketing-host path entries.
async function confirm(formData: FormData) {
  'use server'
  const token = formData.get('token')
  const email = verifyNewsletterConfirmToken(token)
  if (!email) redirect('/unsubscribe/confirm?status=invalid')

  const { created, subscriber } = await confirmSubscription(
    email,
    crypto.randomBytes(32).toString('hex')
  )
  if (created) {
    try {
      await sendNewsletterConfirmation(email, subscriber.unsubscribe_token)
    } catch (err) {
      // The subscription is already committed; a mail hiccup doesn't undo it.
      logger.error('newsletter welcome email failed', { module: 'unsubscribe/confirm', error: err })
    }
  }
  redirect('/unsubscribe/confirm?status=done')
}

export default async function ConfirmNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>
}) {
  const { token, status } = await searchParams

  // Following the emailed link only shows a button: subscribing is a POST the
  // recipient performs, so a mail scanner that opens links can't confirm for them.
  const view: 'ready' | 'done' | 'invalid' =
    status === 'done'
      ? 'done'
      : status === 'invalid' || !verifyNewsletterConfirmToken(token)
        ? 'invalid'
        : 'ready'

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-brand-50 to-brand-100/60" />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface/95 backdrop-blur-sm px-8 py-10 shadow-xl shadow-brand-900/5">
          <div className="mb-6 flex justify-center">
            <Logo width={120} />
          </div>
          {view === 'ready' && (
            <>
              <h1 className="text-center text-lg font-semibold text-ink-900">
                Confirm your signup
              </h1>
              <p className="mt-3 text-center text-sm text-ink-500">
                Press the button to join the answerLoops newsletter.
              </p>
              <form action={confirm} className="mt-6 flex justify-center">
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Confirm my signup
                </button>
              </form>
            </>
          )}
          {view === 'done' && (
            <>
              <h1 className="text-center text-lg font-semibold text-ink-900">You&apos;re subscribed</h1>
              <p className="mt-3 text-center text-sm text-ink-500">
                Thanks for confirming. We&apos;ll be in touch when there&apos;s something worth reading.
              </p>
            </>
          )}
          {view === 'invalid' && (
            <>
              <h1 className="text-center text-lg font-semibold text-ink-900">
                That link isn&apos;t valid
              </h1>
              <p className="mt-3 text-center text-sm text-ink-500">
                This confirmation link has expired or is incorrect. Sign up again from the blog and
                we&apos;ll send a fresh one.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
