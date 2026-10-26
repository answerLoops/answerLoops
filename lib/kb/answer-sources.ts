import type { KBAnswerSourceStatus } from '@/types'
import { contentHash } from './revision'

/**
 * Where a source stands now, judged against what was supplied when the answer
 * was generated. The reference keeps a hash of the article as it was then, so
 * this stays accurate after the article is edited, unpublished or deleted.
 *
 * Precedence, most important first: deleted, unpublished, changed, current. An
 * article that is both unpublished and edited reads as unpublished, because
 * that is the thing a reader can act on.
 */
export function sourceStatus(
  storedHash: string,
  article: { question: string; answer: string; published: number } | null
): KBAnswerSourceStatus {
  if (!article) return 'deleted'
  if (article.published !== 1) return 'unpublished'
  return contentHash(article.question, article.answer) === storedHash ? 'current' : 'changed'
}
