import { and, eq, sql } from 'drizzle-orm'
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
 */
export async function findExactDuplicate(
  executor: Executor,
  orgId: number,
  question: string,
  answer: string
): Promise<number | null> {
  const candidates = await executor
    .select({ id: kbArticles.id, question: kbArticles.question, answer: kbArticles.answer })
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.orgId, orgId),
        // The doubled backslash reaches Postgres as the single-backslash regex escape for whitespace.
        sql`btrim(regexp_replace(${kbArticles.question}, '\\s+', ' ', 'g')) = ${normalizeForHash(question)}`
      )
    )
  const match = candidates.find((c) => isExactDuplicate(c, { question, answer }))
  return match?.id ?? null
}
