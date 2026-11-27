// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { MESSAGE_MAX_CHARS, TRANSCRIPT_MAX_AGE_MS, clearDraft, loadDraft, saveDraft } from '@/lib/widget/transcript'

/**
 * The unsent question kept in the visitor's browser (lib/widget/transcript.ts):
 * per widget, removed when blank, forgotten with the conversation, capped at
 * the message limit, and treated as untrusted when read back.
 */

const TOKEN = 'a'.repeat(48)
const KEY = `al_draft:${TOKEN}`
const NOW = 1_700_000_000_000

beforeEach(() => localStorage.clear())

describe('widget question drafts', () => {
  it('round-trips the text for one widget', () => {
    saveDraft(TOKEN, 'How do I export?', NOW)
    expect(loadDraft(TOKEN, NOW)).toBe('How do I export?')
  })

  it('removes the draft when the box is emptied or only spaces', () => {
    saveDraft(TOKEN, 'Hello', NOW)
    saveDraft(TOKEN, '   ', NOW)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('forgets a draft after the same time as a conversation', () => {
    saveDraft(TOKEN, 'Old question', NOW)
    expect(loadDraft(TOKEN, NOW + TRANSCRIPT_MAX_AGE_MS)).toBe('Old question')
    expect(loadDraft(TOKEN, NOW + TRANSCRIPT_MAX_AGE_MS + 1)).toBe('')
  })

  it('never stores more than the message limit', () => {
    saveDraft(TOKEN, 'x'.repeat(MESSAGE_MAX_CHARS + 100), NOW)
    expect(loadDraft(TOKEN, NOW)).toHaveLength(MESSAGE_MAX_CHARS)
  })

  it('ignores anything in storage that is not a draft it wrote', () => {
    for (const raw of ['not json', '"just a string"', '{"text":5,"at":1}', '{"text":"hi"}', JSON.stringify({ text: 'x'.repeat(MESSAGE_MAX_CHARS + 1), at: NOW })]) {
      localStorage.setItem(KEY, raw)
      expect(loadDraft(TOKEN, NOW)).toBe('')
    }
  })

  it('clears it once sent', () => {
    saveDraft(TOKEN, 'Hello', NOW)
    clearDraft(TOKEN)
    expect(loadDraft(TOKEN, NOW)).toBe('')
  })
})
