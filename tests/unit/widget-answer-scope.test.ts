import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_ANSWER_SCOPE,
  SAFE_WIDGET_ANSWER_SCOPE_FALLBACK,
  WIDGET_ANSWER_SCOPES,
  WIDGET_GUIDANCE_MAX_CHARS,
  isWidgetAnswerScope,
  normalizeWidgetGuidance,
} from '@/lib/widget/answer-scope'

describe('answer scopes', () => {
  it('has exactly the two documented values', () => {
    expect([...WIDGET_ANSWER_SCOPES]).toEqual(['general', 'knowledge-base-only'])
  })

  it('accepts the valid values and nothing else', () => {
    expect(isWidgetAnswerScope('general')).toBe(true)
    expect(isWidgetAnswerScope('knowledge-base-only')).toBe(true)
    for (const bad of ['', 'strict', 'GENERAL', 'general ', null, undefined, 1, {}, ['general']]) {
      expect(isWidgetAnswerScope(bad), String(bad)).toBe(false)
    }
  })

  it('keeps existing workspaces on the behaviour they had', () => {
    expect(DEFAULT_WIDGET_ANSWER_SCOPE).toBe('general')
  })

  it('reads an unrecognised stored value as the narrower scope, never the wider', () => {
    expect(SAFE_WIDGET_ANSWER_SCOPE_FALLBACK).toBe('knowledge-base-only')
  })
})

describe('normalizeWidgetGuidance', () => {
  it('stores nothing for an empty or whitespace-only note', () => {
    expect(normalizeWidgetGuidance('')).toEqual({ ok: true, value: null })
    expect(normalizeWidgetGuidance('  \n \t ')).toEqual({ ok: true, value: null })
    expect(normalizeWidgetGuidance(null)).toEqual({ ok: true, value: null })
    expect(normalizeWidgetGuidance(undefined)).toEqual({ ok: true, value: null })
  })

  it('trims and keeps an ordinary note as typed', () => {
    expect(normalizeWidgetGuidance('  Be warm and brief.  ')).toEqual({ ok: true, value: 'Be warm and brief.' })
  })

  it('normalises line endings and collapses runs of blank lines', () => {
    expect(normalizeWidgetGuidance('one\r\n\r\n\r\n\r\ntwo\rthree')).toEqual({
      ok: true,
      value: 'one\n\ntwo\nthree',
    })
  })

  it('drops control characters but keeps line breaks and tabs out of the way', () => {
    expect(normalizeWidgetGuidance('a\u0000b\u0007c\u001Bd\u007Fe')).toEqual({ ok: true, value: 'abcde' })
    expect(normalizeWidgetGuidance('line one\nline two')).toEqual({ ok: true, value: 'line one\nline two' })
  })

  it('accepts a note of exactly the limit and refuses one character over', () => {
    expect(normalizeWidgetGuidance('x'.repeat(WIDGET_GUIDANCE_MAX_CHARS)).ok).toBe(true)
    const over = normalizeWidgetGuidance('x'.repeat(WIDGET_GUIDANCE_MAX_CHARS + 1))
    expect(over).toEqual({ ok: false, error: `Keep guidance under ${WIDGET_GUIDANCE_MAX_CHARS} characters` })
  })

  it('measures the limit after cleaning, not before', () => {
    const padded = ` ${'x'.repeat(WIDGET_GUIDANCE_MAX_CHARS)} \n\n\n\n`
    expect(normalizeWidgetGuidance(padded).ok).toBe(true)
  })

  it('refuses anything that is not text', () => {
    for (const bad of [42, {}, ['a'], true]) {
      expect(normalizeWidgetGuidance(bad), String(bad)).toEqual({ ok: false, error: 'Invalid guidance' })
    }
  })
})
