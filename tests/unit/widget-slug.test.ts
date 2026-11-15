import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  WIDGET_SLUG_MAX_LENGTH,
  WIDGET_TOKEN_PATTERN,
  isWidgetSlug,
  normalizeWidgetSlug,
  validateWidgetSlug,
} from '@/lib/widget/slug'
import {
  DEFAULT_WIDGET_DISPLAY,
  resolveWidgetDisplay,
} from '@/lib/widget/display-settings'

describe('widget slug rules', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    for (const slug of ['acme', 'acme-support', 'a1b', 'team-42-help']) {
      expect(validateWidgetSlug(slug)).toEqual({ ok: true, slug })
    }
  })

  it('lowercases and trims what a person typed', () => {
    expect(normalizeWidgetSlug('  Acme-Support ')).toBe('acme-support')
    expect(validateWidgetSlug('  Acme-Support ')).toEqual({ ok: true, slug: 'acme-support' })
  })

  it.each(['ab', '', '-acme', 'acme-', 'ac--me', 'ac me', 'acme_support', 'acme.io', 'acmé', 'acme/support'])(
    'rejects %j',
    (value) => {
      expect(validateWidgetSlug(value).ok).toBe(false)
      expect(isWidgetSlug(value)).toBe(false)
    }
  )

  it('rejects names that read as part of the product', () => {
    for (const slug of ['admin', 'api', 'widget', 'answerloops']) {
      expect(validateWidgetSlug(slug)).toMatchObject({ ok: false })
    }
  })

  it('caps the length below a token so a slug can never be mistaken for one', () => {
    expect(WIDGET_SLUG_MAX_LENGTH).toBeLessThan(48)
    expect(validateWidgetSlug('a'.repeat(WIDGET_SLUG_MAX_LENGTH)).ok).toBe(true)
    expect(validateWidgetSlug('a'.repeat(WIDGET_SLUG_MAX_LENGTH + 1)).ok).toBe(false)
    const token = 'abcdef0123456789'.repeat(3)
    expect(WIDGET_TOKEN_PATTERN.test(token)).toBe(true)
    expect(isWidgetSlug(token)).toBe(false)
  })

  it('isWidgetSlug is false for non-strings', () => {
    expect(isWidgetSlug(null)).toBe(false)
    expect(isWidgetSlug(undefined)).toBe(false)
    expect(isWidgetSlug(42)).toBe(false)
  })
})

describe('widget display settings', () => {
  it('serves today\'s look when nothing has been chosen', () => {
    expect(resolveWidgetDisplay(null, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(resolveWidgetDisplay({}, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(DEFAULT_WIDGET_DISPLAY).toEqual({ windowSize: 'small', bubbleColor: '#4f46e5' })
  })

  it('honours a choice when the plan includes customization', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'large', bubbleColor: '#AA00FF' }, { customization: true })
    ).toEqual({ windowSize: 'large', bubbleColor: '#aa00ff' })
  })

  it('ignores the choice entirely when the plan does not include it', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'large', bubbleColor: '#aa00ff' }, { customization: false })
    ).toEqual(DEFAULT_WIDGET_DISPLAY)
  })

  it('falls back per field for unknown sizes and unsafe colors', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'huge', bubbleColor: 'red;}body{display:none' }, { customization: true })
    ).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(
      resolveWidgetDisplay({ windowSize: 'medium', bubbleColor: 'blue' }, { customization: true })
    ).toEqual({ windowSize: 'medium', bubbleColor: '#4f46e5' })
  })

  it('returns a copy, so a caller cannot change the shared default', () => {
    const a = resolveWidgetDisplay(null, { customization: false })
    a.bubbleColor = '#000000'
    expect(DEFAULT_WIDGET_DISPLAY.bubbleColor).toBe('#4f46e5')
  })
})

describe('migration 0073: widget slug column', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'drizzle/0073_widget_slug.sql'), 'utf8')

  it('adds a nullable column idempotently, so existing workspaces are untouched', () => {
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_slug TEXT;/)
    expect(sql).not.toMatch(/widget_slug TEXT NOT NULL/)
  })

  it('enforces uniqueness only among workspaces that have chosen a slug', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS orgs_widget_slug_key ON orgs \(widget_slug\) WHERE widget_slug IS NOT NULL;/)
  })
})
