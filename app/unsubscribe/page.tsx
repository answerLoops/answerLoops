import { Logo } from '@/components/logo'
import { unsubscribeByToken } from '@/lib/db/queries/newsletter'

export const dynamic = 'force-dynamic'

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const result = token ? await unsubscribeByToken(token) : null

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-brand-50 to-brand-100/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.12),_transparent_55%)]" />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface/95 backdrop-blur-sm px-8 py-10 shadow-xl shadow-brand-900/5">
          <div className="mb-6 flex justify-center">
            <Logo width={120} />
          </div>
          {result ? (
            <>
              <h1 className="text-center text-lg font-semibold text-ink-900">
                You&apos;re unsubscribed
              </h1>
              <p className="mt-3 text-center text-sm text-ink-500">
                {result.email} won&apos;t get any more answerLoops newsletter emails.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-center text-lg font-semibold text-ink-900">
                That link isn&apos;t valid
              </h1>
              <p className="mt-3 text-center text-sm text-ink-500">
                This unsubscribe link has expired or was already used. If you&apos;re still
                getting emails you don&apos;t want, reach out to{' '}
                <a href="mailto:support@answerloops.com" className="underline">
                  support@answerloops.com
                </a>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
