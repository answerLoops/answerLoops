import Link from 'next/link'
import { PlatformBudgetExhaustedError, type BudgetKind } from '@/lib/ai/errors'
import type { BudgetStatus } from '@/lib/billing/platform-ai-budget'

const LABEL: Record<BudgetKind, string> = { chat: 'answers', embedding: 'knowledge-base processing' }

// The most severe state wins: a used-up budget over one at 80%; answers over
// knowledge-base processing on a tie.
function pick(status: BudgetStatus): { kind: BudgetKind; exhausted: boolean } | null {
  for (const exhausted of [true, false]) {
    for (const kind of ['chat', 'embedding'] as const) {
      if (exhausted ? status[kind].exhausted : status[kind].warning) return { kind, exhausted }
    }
  }
  return null
}

/**
 * Warns a workspace on included AI usage at 80% of either budget, and again
 * once one is used up. Driven by fractions and flags only; never shows an
 * amount. Gone once the workspace adds its own provider (status is null).
 */
export function AIUsageBanner({ status }: { status: BudgetStatus }) {
  const hit = pick(status)
  if (!hit) return null

  const usage = status.tier === 'trial'
    ? `included trial AI usage for ${LABEL[hit.kind]}`
    : `included AI usage for ${LABEL[hit.kind]} this month`
  const message = hit.exhausted
    ? new PlatformBudgetExhaustedError(0, hit.kind, status.tier).userMessage
    : `You've used 80% of your ${usage}. Add your AI provider so it keeps running when it runs out.`
  const tone = hit.exhausted ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
  const icon = hit.exhausted ? 'text-red-500' : 'text-amber-500'
  const button = hit.exhausted ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'

  return (
    <div
      role={hit.exhausted ? 'alert' : 'status'}
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm sm:mb-6 ${tone}`}
    >
      <svg className={`h-5 w-5 shrink-0 ${icon}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p className="min-w-0 flex-1">{message}</p>
      <Link
        href="/settings?tab=ai"
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${button}`}
      >
        Add AI key
      </Link>
    </div>
  )
}
