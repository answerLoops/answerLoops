import Link from 'next/link'
import type { ReactNode } from 'react'
import type { AIDraftSkipReason } from '@/types'

interface DraftSkippedNoticeProps {
  /** Why the ticket has no draft; null on tickets from before the reason was recorded. */
  reason: AIDraftSkipReason | null
}

const linkClass = 'font-medium underline'

/**
 * Explains why a ticket routed to a person has no AI draft. A link appears
 * only where following it fixes the cause: Settings when the AI limit was
 * reached, Billing when there is no active plan. Every other reason is
 * working as intended or needs nothing from the viewer. A ticket with no
 * recorded reason gets a neutral message rather than a guess.
 */
export function DraftSkippedNotice({ reason }: DraftSkippedNoticeProps) {
  if (reason === 'ai_limit_reached' || reason === 'trial_ai_limit_reached') {
    const settingsLink = (
      <Link href="/settings?tab=ai" className={linkClass}>
        Settings → AI Model
      </Link>
    )
    return (
      <Warning>
        {reason === 'trial_ai_limit_reached' ? (
          <>You&apos;ve reached your trial AI limit, so we couldn&apos;t draft a reply. Add your own AI provider in {settingsLink} to keep drafting.</>
        ) : (
          <>You&apos;ve reached this month&apos;s AI limit, so we couldn&apos;t draft a reply. Add your own AI provider in {settingsLink} to keep drafting, or your limit resets next month.</>
        )}
      </Warning>
    )
  }

  if (reason === 'no_active_plan') {
    return (
      <Warning>
        AI drafting is paused because there&apos;s no active plan on this workspace. Choose a plan in{' '}
        <Link href="/billing" className={linkClass}>
          Billing
        </Link>{' '}
        to turn it back on.
      </Warning>
    )
  }

  const message =
    reason === 'bug_or_feature'
      ? "Bug reports and feature requests aren't answered automatically. A team member will review this one."
      : reason === 'unverified_sender'
        ? "This email is on hold because we couldn't verify the sender. Review it before replying."
        : reason === 'ai_unavailable'
          ? "We couldn't draft a reply for this ticket. A team member will need to review it."
          : 'No AI draft was generated for this ticket. A team member will review it.'

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
      {message}
    </div>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
      {children}
    </div>
  )
}
