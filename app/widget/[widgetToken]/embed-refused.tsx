/**
 * Shown inside the iframe when the widget is not permitted on the embedding
 * page. Deliberately explains the fix rather than failing blank: the person
 * seeing this is almost always the site owner who just pasted the snippet, and
 * a silent empty panel gives them nothing to act on.
 *
 * It names the offending origin and nothing else — not the org, the knowledge
 * base, or whether the token is valid. Keep it that way when editing.
 */
export function EmbedRefused({
  reason,
  origin,
}: {
  reason: 'not-configured' | 'origin-not-allowed' | 'origin-unknown'
  origin: string | null
}) {
  const message =
    reason === 'not-configured'
      ? 'This chat widget has no allowed domains configured yet.'
      : reason === 'origin-unknown'
        ? 'This chat widget could not confirm which site it is embedded on.'
        : `This chat widget is not enabled for ${origin}.`

  const hint =
    reason === 'origin-unknown'
      ? 'This can happen when the page blocks referrer information. Loading the widget over HTTPS usually resolves it.'
      : 'Add this domain under Settings → Widget → Allowed domains in answerLoops.'

  return (
    <div className="flex h-full items-center justify-center bg-white p-6">
      <div className="max-w-xs space-y-2 text-center">
        <p className="text-sm font-medium text-gray-900">{message}</p>
        <p className="text-xs text-gray-500">{hint}</p>
      </div>
    </div>
  )
}
