/**
 * A GitHub comment sent by replying to a notification email carries the whole
 * email: the person's reply, then the quoted notification they replied to, then
 * GitHub's footer with its tracking links. The ticket page splits those apart,
 * so the reply reads first and the rest sits behind a toggle instead of
 * burying the reply under a wall of links.
 *
 * Display only: the stored ticket text is never changed.
 */

// The line mail clients add above a quoted message ("On Mon, X wrote:" and its
// translations), and the line GitHub starts its footer with.
const QUOTE_START = [
  /^.*\b(?:wrote|a écrit|escribió|schrieb|ha scritto|escreveu|schreef|skrev|kirjoitti)\s*:\s*$/im,
  /^\s*[—–-]{1,2}\s*\n?\s*Reply to this email directly, view it on GitHub/im,
]

export function splitEmailQuote(text: string): { reply: string; quoted: string | null } {
  let cut = -1
  for (const pattern of QUOTE_START) {
    const index = text.search(pattern)
    if (index !== -1 && (cut === -1 || index < cut)) cut = index
  }
  if (cut === -1) return { reply: text, quoted: null }

  const reply = text.slice(0, cut).trim()
  // Nothing before the marker means it is not a reply with a quote under it
  // (the whole message may simply mention the phrase), so leave it as it is.
  if (!reply) return { reply: text, quoted: null }
  return { reply, quoted: text.slice(cut).trim() }
}
