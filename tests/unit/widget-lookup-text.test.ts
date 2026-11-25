import { describe, it, expect } from 'vitest'
import { widgetLookupText, FOLLOW_UP_MAX_WORDS, PREVIOUS_QUESTION_MAX_CHARS } from '@/lib/widget/lookup-text'

// What the widget searches the knowledge base with: the visitor's latest
// message, plus their previous question when the latest is a short follow-up
// that can't stand on its own ("and for teams?").

const user = (content: string) => ({ role: 'user', content })
const bot = (content: string) => ({ role: 'assistant', content })

describe('widgetLookupText', () => {
  it('uses the message alone for a first question, however short', () => {
    expect(widgetLookupText([user('What does it cost?')])).toBe('What does it cost?')
  })

  it('a short follow-up carries the previous question', () => {
    const messages = [user('What does it cost?'), bot('The Pro plan is $149 a month.'), user('and for teams?')]
    expect(widgetLookupText(messages)).toBe('What does it cost?\nand for teams?')
  })

  it('a message long enough to stand alone is searched on its own', () => {
    const messages = [user('What does it cost?'), bot('…'), user('How do I connect my Discord server to the bot?')]
    expect(widgetLookupText(messages)).toBe('How do I connect my Discord server to the bot?')
  })

  it('counts words, so five or fewer is a follow-up and six is not', () => {
    expect(FOLLOW_UP_MAX_WORDS).toBe(5)
    const prev = [user('Pricing please'), bot('…')]
    expect(widgetLookupText([...prev, user('one two three four five')])).toBe('Pricing please\none two three four five')
    expect(widgetLookupText([...prev, user('one two three four five six')])).toBe('one two three four five six')
  })

  it('uses only the visitor\'s own questions, never the assistant\'s replies', () => {
    const messages = [user('Do you have an API?'), bot('Yes, a REST API.'), user('rate limits?')]
    expect(widgetLookupText(messages)).toBe('Do you have an API?\nrate limits?')
  })

  it('shortens a very long previous question', () => {
    const long = 'x'.repeat(PREVIOUS_QUESTION_MAX_CHARS + 200)
    const text = widgetLookupText([user(long), bot('…'), user('and then?')])
    expect(text).toBe(`${'x'.repeat(PREVIOUS_QUESTION_MAX_CHARS)}\nand then?`)
  })

  it('skips empty earlier messages and trims whitespace', () => {
    expect(widgetLookupText([user('  Refund policy  '), user('   '), bot('…'), user('  and? ')])).toBe('Refund policy\nand?')
  })

  it('returns an empty string when there is no visitor message', () => {
    expect(widgetLookupText([bot('Hi!')])).toBe('')
  })
})
