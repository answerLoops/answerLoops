import { describe, expect, it } from 'vitest'
import {
  MAX_CONTACT_ARTICLES,
  contactArticlesForTurn,
  listsContactDetails,
  needsContactLookup,
} from '@/lib/widget/contact-context'

/**
 * Which contact articles the widget shows the model beside a question its
 * knowledge base doesn't cover (lib/widget/contact-context.ts).
 */

const article = (answer: string, articleId?: number, summary = 'Article') => ({ summary, answer, articleId })

describe('needsContactLookup', () => {
  it('looks up contact details for a real question in knowledge-base-only scope', () => {
    expect(needsContactLookup('knowledge-base-only', 'Do you ship to Canada?')).toBe(true)
  })

  it('never looks them up in general scope, which stays as it was', () => {
    expect(needsContactLookup('general', 'Do you ship to Canada?')).toBe(false)
  })

  it('treats anything but an explicit general scope as knowledge-base-only, like the instructions', () => {
    expect(needsContactLookup('kb-only' as 'general', 'Do you ship to Canada?')).toBe(true)
  })

  it('skips greetings and thanks, which get a warm reply instead', () => {
    for (const q of ['hi', 'Hello!', 'thanks', 'thank you so much', 'ok cool']) {
      expect(needsContactLookup('knowledge-base-only', q), q).toBe(false)
    }
  })

  it('still looks them up for a question that starts with thanks', () => {
    expect(needsContactLookup('knowledge-base-only', 'thanks for the help, but do you ship to Canada?')).toBe(true)
  })
})

describe('listsContactDetails', () => {
  it('accepts an article with an email address', () => {
    expect(listsContactDetails(article('Write to help@acme.test any time.'))).toBe(true)
  })

  it('accepts a phone number or link next to wording about getting in touch', () => {
    expect(listsContactDetails(article('Call us on +1 (555) 010-2000.'))).toBe(true)
    expect(listsContactDetails(article('Our support page: https://acme.test/help'))).toBe(true)
  })

  it('counts the title as part of the article', () => {
    expect(listsContactDetails(article('https://acme.test/help', undefined, 'Contact us'))).toBe(true)
  })

  it('rejects a date, order number or link with no contact wording', () => {
    expect(listsContactDetails(article('Version 2 shipped on 2024-01-15.'))).toBe(false)
    expect(listsContactDetails(article('See https://acme.test/changelog for details.'))).toBe(false)
  })

  it('rejects a short number even beside contact wording', () => {
    expect(listsContactDetails(article('Contact us within 30 days.'))).toBe(false)
  })
})

describe('contactArticlesForTurn', () => {
  const contact = article('Email help@acme.test', 40)
  const phone = article('Call support on 555 010 2000', 41)
  const web = article('Support: https://acme.test/support', 42)
  const plain = article('We started in 2019.', 43)

  it('returns nothing when the question found a strong match', () => {
    expect(contactArticlesForTurn({ articles: [article('Run npm i', 1)], matched: true }, { articles: [contact], matched: true })).toEqual([])
  })

  it('returns contact articles when nothing matched at all', () => {
    expect(contactArticlesForTurn({ articles: [], matched: false }, { articles: [contact], matched: false })).toEqual([contact])
  })

  it('returns contact articles beside near misses', () => {
    expect(contactArticlesForTurn({ articles: [article('Run npm i', 1)], matched: false }, { articles: [contact], matched: true })).toEqual([contact])
  })

  it('treats a strong-match flag with no articles as not covered', () => {
    expect(contactArticlesForTurn({ articles: [], matched: true }, { articles: [contact], matched: false })).toEqual([contact])
  })

  it('drops results that state no way to reach anyone', () => {
    expect(contactArticlesForTurn({ articles: [], matched: false }, { articles: [plain, contact], matched: false })).toEqual([contact])
  })

  it('drops an article the question already found, which the model can already see', () => {
    expect(contactArticlesForTurn({ articles: [contact], matched: false }, { articles: [contact, phone], matched: false })).toEqual([phone])
  })

  it(`keeps at most ${MAX_CONTACT_ARTICLES}`, () => {
    expect(
      contactArticlesForTurn({ articles: [], matched: false }, { articles: [contact, phone, web], matched: false }),
    ).toHaveLength(MAX_CONTACT_ARTICLES)
  })
})
