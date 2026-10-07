/**
 * The product feedback board is how answerLoops collects feedback on the
 * product itself, so it exists only on the answerLoops-operated deployment.
 * It is off unless `FEEDBACK_WIDGET_ENABLED` is `true` or `1`: when off the
 * widget never renders and its API route and submit action are both
 * closed. A self-hosted deployment never sets it, so it has no board at all.
 *
 * Read at call time (not module load) so it reflects the running environment.
 */
export function isFeedbackWidgetEnabled(): boolean {
  const v = process.env.FEEDBACK_WIDGET_ENABLED?.trim().toLowerCase()
  return v === 'true' || v === '1'
}
