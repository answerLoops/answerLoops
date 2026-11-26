import type { PriorAnswer, WidgetKBContext } from '@/types'
import type { WidgetAnswerScope } from '@/lib/widget/answer-scope'
import { isGreetingOrAck } from '@/lib/widget/lead-capture'

/**
 * Contact details for a question the knowledge base doesn't cover.
 *
 * When a widget answers only from its knowledge base and a visitor asks
 * something the articles don't cover, the assistant says so and offers a way
 * to reach the business. The search for the visitor's question rarely finds
 * the business's contact article, because "Do you ship to Canada?" has nothing
 * in common with "Contact us", so the widget also looks that article up on its
 * own and shows it to the assistant beside the question's results. The
 * contact card only shows an email, phone number or page that appears in that
 * text (lib/widget/genui-tools.ts), so nothing here lets the assistant invent
 * a way to reach anyone.
 *
 * Kept out of the turn's own articles (lib/widget/turn-context.ts) on
 * purpose: those decide whether the question was answered (the review queue
 * and the on-failure lead prompt) and which articles an answer drew on, and a
 * contact article handed over for a fallback answered nothing.
 */

/** What the knowledge base is searched with to find how to reach the business. */
export const CONTACT_LOOKUP_QUERY = 'How do I contact support? Email address, phone number or support page'

/** At most this many articles are passed along as contact details. */
export const MAX_CONTACT_ARTICLES = 2

/**
 * Whether this turn needs the contact lookup: only when the widget answers
 * from its knowledge base alone (general scope answers from general knowledge
 * instead and is left exactly as it was), and never for a greeting or thanks,
 * which is answered warmly, not with contact options. Like the instructions
 * (lib/widget/instructions.ts), anything but an explicit `general` is treated
 * as knowledge-base-only, so the two can never disagree about the scope.
 */
export function needsContactLookup(scope: WidgetAnswerScope, query: string): boolean {
  return scope !== 'general' && !isGreetingOrAck(query)
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i
const URL = /https?:\/\/[^\s<>"')]+/i
// Seven or more digits, allowing the usual separators. Dates and order numbers
// look like this too, which is why a phone-like number only counts beside a
// word about getting in touch.
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/
const CONTACT_WORDS = /\b(contact|support|help ?desk|help center|email|e-mail|phone|call|reach|get in touch|customer service)\b/i

const digitCount = (s: string) => s.replace(/\D/g, '').length

/**
 * Whether an article states a way to reach the business: an email address,
 * or a phone number or link next to wording about contacting or support.
 */
export function listsContactDetails(article: PriorAnswer): boolean {
  const text = `${article.summary}\n${article.answer}`
  if (EMAIL.test(text)) return true
  if (!CONTACT_WORDS.test(text)) return false
  if (URL.test(text)) return true
  const phone = text.match(PHONE)
  return phone !== null && digitCount(phone[0]) >= 7
}

/**
 * The contact articles to show the assistant this turn: none when the
 * question's own lookup found a strong match (the question is covered, so
 * there is nothing to fall back from), and otherwise up to
 * MAX_CONTACT_ARTICLES from the contact lookup that state a way to reach the
 * business and were not already among the question's own results.
 */
export function contactArticlesForTurn(question: WidgetKBContext, contact: WidgetKBContext): PriorAnswer[] {
  if (question.matched && question.articles.length > 0) return []
  const already = new Set(question.articles.map((a) => a.articleId).filter((id) => id !== undefined))
  return contact.articles
    .filter((a) => a.articleId === undefined || !already.has(a.articleId))
    .filter(listsContactDetails)
    .slice(0, MAX_CONTACT_ARTICLES)
}
