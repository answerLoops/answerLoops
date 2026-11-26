interface ReviewNoticeInput {
  sourcePlatform: string | null
  autoDeflected: boolean
  /** The source channel's integration row, or null when there is none (never connected, or disconnected). */
  sourceIntegration: { auto_deflect_enabled: number } | null
}

/**
 * The line under "needs human review" on a ticket's confidence card, or null
 * when the low score alone explains the hold.
 *
 * "Needs human review" reads the same whether the answer was genuinely
 * low-confidence or nothing could be sent for it. This line covers the second
 * case: a channel only gets a notice while its integration has Automatic
 * Deflections off.
 */
export function reviewNoticeFor({ sourcePlatform, autoDeflected, sourceIntegration }: ReviewNoticeInput): string | null {
  if (autoDeflected) return null
  if (sourceIntegration && sourceIntegration.auto_deflect_enabled !== 1) {
    return `Automatic Deflections is off for ${sourcePlatform} — nothing was sent to the customer. Approve and send the draft below, or reply manually.`
  }
  return null
}
