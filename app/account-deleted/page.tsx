import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Logo } from '@/components/logo'
import { getAccountDeletionInfo } from '@/app/actions/account'
import { logout } from '@/app/actions/auth'
import { RestoreAccountButton } from '@/components/dashboard/restore-account-button'

export const dynamic = 'force-dynamic'

export default async function AccountDeletedPage() {
  if (!(await auth())) {
    redirect('/login')
  }

  const info = await getAccountDeletionInfo()

  // Not actually deleted (or the deletion already got restored elsewhere) —
  // nothing to show here, send them back to the app.
  if (!info) {
    redirect('/dashboard')
  }

  const purgeDate = new Date(info.purgeAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-brand-50 to-brand-100/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.12),_transparent_55%)]" />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-border bg-surface/95 backdrop-blur-sm px-8 py-10 shadow-xl shadow-brand-900/5">
          <div className="mb-6 flex justify-center">
            <Logo width={120} />
          </div>
          <h1 className="text-center text-lg font-semibold text-ink-900">
            {info.orgName} is scheduled for deletion
          </h1>
          <p className="mt-3 text-center text-sm text-ink-500">
            All data will be permanently deleted on <strong>{purgeDate}</strong>. Until
            then, {info.canRestore ? 'you can restore it below.' : 'only the workspace owner can restore it.'}
          </p>

          {info.canRestore && (
            <div className="mt-6">
              <RestoreAccountButton />
            </div>
          )}

          <form action={logout} className="mt-6 text-center">
            <button type="submit" className="text-xs text-ink-400 underline hover:text-ink-500">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
