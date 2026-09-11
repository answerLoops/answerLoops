import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { getOrg } from '@/lib/db/queries/orgs'
import { getDb } from '@/lib/db/drizzle'
import { users } from '@/lib/db/schema'
import { acceptInviteAction } from '@/app/actions/invitations'
import { logoutAndReturnTo } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string; email?: string }>
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: 'This invite link is invalid or has already been used.',
  expired: 'This invite link has expired. Ask the workspace admin to send a new one.',
}

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params
  const { error, email } = await searchParams
  const session = await auth()

  if (!session?.user) {
    redirect(`/login?callbackUrl=/invite/${token}`)
  }

  if (error === 'email_mismatch') {
    return (
      <InviteShell>
        <EmailMismatchCard
          token={token}
          invitedEmail={email ?? 'the invited address'}
          signedInEmail={session.user.email ?? 'this account'}
        />
      </InviteShell>
    )
  }

  if (error) {
    return (
      <InviteShell>
        <ErrorCard message={ERROR_MESSAGES[error] ?? 'Something went wrong with this invite.'} />
      </InviteShell>
    )
  }

  const invite = await getInvitationByToken(token)

  if (!invite || invite.accepted_at) {
    return <InviteShell><ErrorCard message={ERROR_MESSAGES.invalid} /></InviteShell>
  }

  if (invite.expires_at < new Date().toISOString()) {
    return <InviteShell><ErrorCard message={ERROR_MESSAGES.expired} /></InviteShell>
  }

  // Shown up front, before the Accept button, rather than only after a
  // submit round-trip — a shared browser can already have a valid session
  // for a completely different account than the one this invite was sent
  // to (e.g. the org owner testing the flow), and accepting under the
  // wrong identity would silently consume someone else's invite.
  // acceptInviteAction re-checks this server-side too as defense-in-depth.
  if (session.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <InviteShell>
        <EmailMismatchCard
          token={token}
          invitedEmail={invite.email}
          signedInEmail={session.user.email ?? 'this account'}
        />
      </InviteShell>
    )
  }

  const org = await getOrg(invite.org_id)
  const inviter = invite.invited_by
    ? (await getDb()
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, invite.invited_by))
        .limit(1))[0] ?? null
    : null

  const boundAction = acceptInviteAction.bind(null, token)

  return (
    <InviteShell>
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xl font-bold mx-auto">
            {org?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <h1 className="text-base font-semibold text-gray-900 mt-3">
            You've been invited to join{' '}
            <span className="text-brand-600">{org?.name ?? 'a workspace'}</span>
          </h1>
          {inviter && (
            <p className="text-sm text-gray-500">
              Invited by {inviter.name ?? inviter.email}
            </p>
          )}
          <p className="text-xs text-gray-400">
            You'll join as <span className="font-medium capitalize">{invite.role}</span>
          </p>
        </div>

        <form action={boundAction}>
          <Button type="submit" className="w-full">
            Accept invitation
          </Button>
        </form>

        <p className="text-center text-xs text-gray-400">
          Signed in as <span className="font-medium">{session.user.email}</span>
        </p>
      </div>
    </InviteShell>
  )
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <span className="text-sm font-bold text-brand-600 tracking-tight">answerLoops</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-red-50 border border-red-200 p-4">
        <p className="text-sm text-red-700">{message}</p>
      </div>
      <a href="/dashboard" className="block text-center text-sm text-brand-600 hover:underline">
        Go to dashboard
      </a>
    </div>
  )
}

function EmailMismatchCard({
  token,
  invitedEmail,
  signedInEmail,
}: {
  token: string
  invitedEmail: string
  signedInEmail: string
}) {
  const boundSwitchAccount = logoutAndReturnTo.bind(null, `/invite/${token}`)

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-amber-50 border border-amber-200 p-4">
        <p className="text-sm text-amber-800">
          This invite was sent to <span className="font-medium">{invitedEmail}</span>, but you&apos;re
          signed in as <span className="font-medium">{signedInEmail}</span>.
        </p>
        <p className="mt-2 text-sm text-amber-800">
          Sign out and sign back in as {invitedEmail} to accept it.
        </p>
      </div>
      <form action={boundSwitchAccount}>
        <Button type="submit" className="w-full">
          Sign out and switch accounts
        </Button>
      </form>
      <a href="/dashboard" className="block text-center text-sm text-brand-600 hover:underline">
        Go to dashboard instead
      </a>
    </div>
  )
}
