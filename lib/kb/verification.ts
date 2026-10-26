import type { ArticleVerification, ArticleVerificationStatus } from '@/types'
import { contentHash } from './revision'

export { VERIFICATION_NOTE_MAX } from './verification-limits'

/**
 * Where an article stands, judged against its text right now. It is verified
 * only while the question and answer still hash to what the verifier checked;
 * once the words change it reads as changed since last verified, and verifying
 * again clears that. Age plays no part: an old verification of unchanged text
 * is still a verification.
 */
export function verificationStatus(article: {
  question: string
  answer: string
  verifiedAt: string | null
  verifiedContentHash: string | null
}): ArticleVerificationStatus {
  if (article.verifiedAt === null) return 'never'
  return article.verifiedContentHash === contentHash(article.question, article.answer) ? 'verified' : 'changed'
}

/** The verification facts the dashboard shows for one article. */
export function toVerification(
  article: {
    question: string
    answer: string
    verifiedAt: string | null
    verifiedBy: number | null
    verifiedContentHash: string | null
    verificationNote: string | null
  },
  verifierName: string | null
): ArticleVerification {
  return {
    status: verificationStatus(article),
    verified_at: article.verifiedAt,
    verified_by: article.verifiedBy,
    verified_by_name: verifierName,
    note: article.verificationNote,
  }
}
