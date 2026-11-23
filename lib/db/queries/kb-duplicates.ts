import { and, eq, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles } from '../schema'
import { isExactDuplicate } from '@/lib/kb/duplicates'
import { normalizeForHash } from '@/lib/kb/revision'

// Either a database or an open transaction; both can run this select.
type Executor = Pick<ReturnType<typeof getDb>, 'select'>

/** Thrown when an article cannot be added because an exact copy is already in the workspace. */
export class DuplicateArticleError extends Error {
  readonly existingId: number
  constructor(existingId: number) {
    super('This is already in the knowledge base')
    this.name = 'DuplicateArticleError'
    this.existingId = existingId
  }
}

/**
 * The id of an article in this workspace whose question and answer are exactly
 * the given text (see isExactDuplicate), or null.
 *
 * The database narrows the candidates to articles whose question matches after
 * the same whitespace collapsing the fingerprint uses, then the fingerprint
 * itself decides, so a match is always a true exact duplicate. The narrowing
 * can only miss, never wrongly match: text with unusual whitespace that the
 * database treats differently from the fingerprint is simply not found here,
 * and retrieval still never supplies the same text twice.
 *
 * An imported section passes `sectionHeading`, the heading its title was built
 * from. Imported titles carry the page or file in front ("Pricing › Pro", see
 * chunkMarkdown), so the same section uploaded under another file name, or
 * repeated across the pages of a site crawl, would otherwise never count as a
 * copy. For a section, a copy is the same heading over the same body, whatever
 * page title is in front of it, including an article imported before titles
 * carried the page at all (a bare "Pro").
 */
export async function findExactDuplicate(
  executor: Executor,
  orgId: number,
  question: string,
  answer: string,
  opts?: { sectionHeading?: string }
): Promise<number | null> {
  // The doubled backslash reaches Postgres as the single-backslash regex escape for whitespace.
  const storedQuestion = sql`btrim(regexp_replace(${kbArticles.question}, '\\s+', ' ', 'g'))`
  const full = normalizeForHash(question)
  const heading = opts?.sectionHeading === undefined ? '' : normalizeForHash(opts.sectionHeading)
  const asSection = heading !== '' && heading !== full

  const candidates = await executor
    .select({ id: kbArticles.id, question: kbArticles.question, answer: kbArticles.answer })
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.orgId, orgId),
        asSection
          ? or(
              sql`${storedQuestion} = ${full}`,
              sql`${storedQuestion} = ${heading}`,
              sql`${storedQuestion} LIKE ${`%${SECTION_SEPARATOR}${escapeLike(heading)}`}`
            )
          : sql`${storedQuestion} = ${full}`
      )
    )
  const match = candidates.find((c) =>
    asSection
      ? isExactDuplicate({ question: '', answer: c.answer }, { question: '', answer }) && isSameSection(c.question, full, heading)
      : isExactDuplicate(c, { question, answer })
  )
  return match?.id ?? null
}

// What chunkMarkdown puts between a page title and a section heading.
const SECTION_SEPARATOR = ' › '

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// The database narrowing is a LIKE, which also matches a heading that merely
// ends the same way ("Not getting started" for "getting started"); this keeps
// only the same title, the bare heading, or the heading after a page title.
function isSameSection(storedQuestion: string, full: string, heading: string): boolean {
  const stored = normalizeForHash(storedQuestion)
  return stored === full || stored === heading || stored.endsWith(`${SECTION_SEPARATOR}${heading}`)
}
