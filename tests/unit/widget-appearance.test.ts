import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_BRAND_COLOR,
  ON_BRAND_DARK,
  ON_BRAND_LIGHT,
  STARTER_QUESTIONS_LIMIT_MESSAGE,
  WIDGET_STARTER_QUESTIONS_MAX,
  WIDGET_STARTER_QUESTION_MAX_CHARS,
  WIDGET_TITLE_MAX_CHARS,
  WIDGET_WELCOME_MAX_CHARS,
  brandPalette,
  contrastRatio,
  isValidBrandColor,
  normalizeBrandColor,
  normalizeStarterQuestions,
  normalizeWidgetTitle,
  normalizeWidgetWelcome,
  readWidgetAppearance,
  readableTextColor,
  readStarterEnabled,
  readStarterQuestions,
  serializeStarterEnabled,
  serializeStarterQuestions,
} from '@/lib/widget/appearance'

const HEX = /^#[0-9a-f]{6}$/

describe('title and welcome message', () => {
  it('trims, collapses spaces and treats an empty value as "use the default"', () => {
    expect(normalizeWidgetTitle('  Acme   Support  ')).toEqual({ ok: true, value: 'Acme Support' })
    expect(normalizeWidgetTitle('   ')).toEqual({ ok: true, value: null })
    expect(normalizeWidgetTitle('')).toEqual({ ok: true, value: null })
    expect(normalizeWidgetTitle(null)).toEqual({ ok: true, value: null })
    expect(normalizeWidgetTitle(undefined)).toEqual({ ok: true, value: null })
    expect(normalizeWidgetWelcome('  Hi there  ')).toEqual({ ok: true, value: 'Hi there' })
  })

  it('accepts the longest allowed value and refuses one character more', () => {
    expect(normalizeWidgetTitle('t'.repeat(WIDGET_TITLE_MAX_CHARS)).ok).toBe(true)
    expect(normalizeWidgetTitle('t'.repeat(WIDGET_TITLE_MAX_CHARS + 1)).ok).toBe(false)
    expect(normalizeWidgetWelcome('w'.repeat(WIDGET_WELCOME_MAX_CHARS)).ok).toBe(true)
    const tooLong = normalizeWidgetWelcome('w'.repeat(WIDGET_WELCOME_MAX_CHARS + 1))
    expect(tooLong).toEqual({ ok: false, error: `Keep the welcome message under ${WIDGET_WELCOME_MAX_CHARS} characters` })
  })

  it('counts length after cleaning, so padding does not use up the limit', () => {
    expect(normalizeWidgetTitle(` ${'t'.repeat(WIDGET_TITLE_MAX_CHARS)} `).ok).toBe(true)
  })

  it('turns line breaks and tabs into spaces and drops control characters', () => {
    expect(normalizeWidgetTitle('Acme\nSupport\t\u0000Desk\u0007')).toEqual({ ok: true, value: 'Acme Support Desk' })
  })

  it('keeps markup as plain characters; the widget renders it as text', () => {
    expect(normalizeWidgetTitle('<b>Acme</b> & Co')).toEqual({ ok: true, value: '<b>Acme</b> & Co' })
  })

  it('refuses a value that is not text', () => {
    for (const bad of [42, {}, [], true]) {
      expect(normalizeWidgetTitle(bad).ok).toBe(false)
      expect(normalizeWidgetWelcome(bad).ok).toBe(false)
    }
  })
})

describe('brand color validation', () => {
  it('accepts a full six-digit hex color in either case and stores it lowercased', () => {
    expect(isValidBrandColor('#1a73e8')).toBe(true)
    expect(isValidBrandColor('#1A73E8')).toBe(true)
    expect(normalizeBrandColor(' #1A73E8 ')).toEqual({ ok: true, value: '#1a73e8' })
  })

  it('treats empty and missing as "use the default"', () => {
    expect(normalizeBrandColor('')).toEqual({ ok: true, value: null })
    expect(normalizeBrandColor('   ')).toEqual({ ok: true, value: null })
    expect(normalizeBrandColor(null)).toEqual({ ok: true, value: null })
    expect(normalizeBrandColor(undefined)).toEqual({ ok: true, value: null })
  })

  it('refuses everything that is not a plain #rrggbb, with a clear message', () => {
    const bad = [
      'red',
      '#fff',
      '#ffff',
      'ffd60a',
      '#12345g',
      '#1234567',
      '#12345',
      'rgb(1,2,3)',
      'hsl(10 50% 50%)',
      'url(javascript:alert(1))',
      '#fff;}body{display:none',
      '#ffd60a"><script>x</script>',
      'var(--x)',
      '#ffd60a\n#000000',
    ]
    for (const value of bad) {
      expect(isValidBrandColor(value), value).toBe(false)
      expect(normalizeBrandColor(value), value).toEqual({ ok: false, error: 'Choose a color like #1a73e8.' })
    }
    expect(normalizeBrandColor(123)).toEqual({ ok: false, error: 'Choose a color like #1a73e8.' })
  })
})

describe('readable text on a brand color', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('picks white on dark and mid-dark colors and near-black on light ones', () => {
    expect(readableTextColor('#0b1f4d')).toBe(ON_BRAND_LIGHT) // navy
    expect(readableTextColor('#000000')).toBe(ON_BRAND_LIGHT)
    expect(readableTextColor('#2563eb')).toBe(ON_BRAND_LIGHT) // the default blue
    expect(readableTextColor('#aa00ff')).toBe(ON_BRAND_LIGHT)
    expect(readableTextColor('#ffd60a')).toBe(ON_BRAND_DARK) // yellow
    expect(readableTextColor('#ffffff')).toBe(ON_BRAND_DARK)
    expect(readableTextColor('#00ff00')).toBe(ON_BRAND_DARK)
  })

  it('always leaves at least 4.5:1 for very light, very dark and mid-tone colors', () => {
    // A mid grey is the hardest case: neither choice reaches 4.5 for a few
    // colors in the middle, so the floor asserted is the best of the two,
    // and every color away from the exact middle clears 4.5.
    const colors = [
      '#000000', '#0b1f4d', '#112233', '#2563eb', '#aa00ff', '#d32f2f', '#e65100', '#ffd60a', '#ffeb3b',
      '#a5d6a7', '#ffffff', '#f5f5f5', '#fafafa', '#222222', '#111827', '#00695c', '#4caf50',
    ]
    for (const color of colors) {
      const text = readableTextColor(color)
      const ratio = contrastRatio(color, text)
      expect(ratio, `${color} with ${text}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('never does worse than the other choice, even for the colors in the middle', () => {
    for (const color of ['#808080', '#7f7f7f', '#767676', '#6a6a6a', '#888888', '#ff5722', '#9e9e9e']) {
      const chosen = contrastRatio(color, readableTextColor(color))
      const other = contrastRatio(color, readableTextColor(color) === ON_BRAND_LIGHT ? ON_BRAND_DARK : ON_BRAND_LIGHT)
      expect(chosen, color).toBeGreaterThanOrEqual(other)
    }
  })
})

describe('brand palette', () => {
  const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

  it('makes brand-600 exactly the chosen color', () => {
    for (const color of ['#2563eb', '#ffd60a', '#0b1f4d', '#aa00ff', '#000000', '#ffffff', '#808080']) {
      expect(brandPalette(color)['--brand-600']).toBe(color)
    }
  })

  it('returns every step and the on-color, all as plain #rrggbb', () => {
    for (const color of ['#2563eb', '#ffd60a', '#0b1f4d', '#000000', '#ffffff']) {
      const palette = brandPalette(color)
      expect(Object.keys(palette).sort()).toEqual(
        [...STEPS.map((s) => `--brand-${s}`), '--brand-on'].sort()
      )
      for (const [name, value] of Object.entries(palette)) {
        expect(value, `${color} ${name}`).toMatch(HEX)
      }
    }
  })

  it('runs from lighter than the color to darker than it, in order', () => {
    const lightness = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
    }
    for (const color of ['#2563eb', '#ffd60a', '#0b1f4d', '#aa00ff', '#808080']) {
      const palette = brandPalette(color)
      const values = STEPS.map((s) => lightness(palette[`--brand-${s}`]))
      for (let i = 1; i < values.length; i++) {
        expect(values[i - 1], `${color} step ${STEPS[i - 1]} vs ${STEPS[i]}`).toBeGreaterThanOrEqual(values[i] - 0.001)
      }
      expect(values[0]).toBeGreaterThan(0.85) // brand-50 is a tint
    }
  })

  it('gives very dark and very pale colors hover shades that differ from the color', () => {
    expect(brandPalette('#0b1f4d')['--brand-700']).not.toBe('#0b1f4d')
    expect(brandPalette('#ffd60a')['--brand-700']).not.toBe('#ffd60a')
    expect(brandPalette('#ffd60a')['--brand-50']).not.toBe('#ffd60a')
  })

  it('sets the on-color to the readable text for the chosen color', () => {
    expect(brandPalette('#ffd60a')['--brand-on']).toBe(ON_BRAND_DARK)
    expect(brandPalette('#0b1f4d')['--brand-on']).toBe(ON_BRAND_LIGHT)
  })

  it('never passes raw input through: an invalid color gives the default scale', () => {
    const palette = brandPalette('url(javascript:alert(1))')
    expect(palette['--brand-600']).toBe(DEFAULT_WIDGET_BRAND_COLOR)
    expect(JSON.stringify(palette)).not.toContain('javascript')
    for (const value of Object.values(palette)) expect(value).toMatch(HEX)
  })

  it('matches the app default scale: brand-600 of the default is the app blue', () => {
    expect(DEFAULT_WIDGET_BRAND_COLOR).toBe('#2563eb')
  })
})

describe('reading stored values', () => {
  it('returns what is valid and null for anything that would not pass the write checks', () => {
    expect(readWidgetAppearance({ title: 'Acme', welcome: 'Hi', brandColor: '#FFD60A' })).toEqual({
      title: 'Acme',
      welcome: 'Hi',
      brandColor: '#ffd60a',
      starterQuestions: [],
      starterEnabled: true,
      followUpsEnabled: true,
    })
    expect(
      readWidgetAppearance({
        title: 't'.repeat(WIDGET_TITLE_MAX_CHARS + 5),
        welcome: 'w'.repeat(WIDGET_WELCOME_MAX_CHARS + 5),
        brandColor: 'red;}',
      })
    ).toEqual({ title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
    expect(readWidgetAppearance({})).toEqual({ title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
  })
})

describe('starter questions', () => {
  it('has the limits the settings page and the docs state', () => {
    expect(WIDGET_STARTER_QUESTIONS_MAX).toBe(4)
    expect(WIDGET_STARTER_QUESTION_MAX_CHARS).toBe(80)
    expect(STARTER_QUESTIONS_LIMIT_MESSAGE).toBe('Use up to 4 starter questions, 80 characters each.')
  })

  it('takes one question per line: trimmed, no blanks, no repeats in any letter case', () => {
    expect(normalizeStarterQuestions('  How does it work?  \r\n\n What does it cost?\nhow does it work?\n ')).toEqual({
      ok: true,
      value: ['How does it work?', 'What does it cost?'],
    })
    expect(normalizeStarterQuestions(['One', 'Two'])).toEqual({ ok: true, value: ['One', 'Two'] })
  })

  it('treats nothing, empty and blank lines as "show none"', () => {
    for (const empty of [null, undefined, '', '   ', '\n\n \n', []]) {
      expect(normalizeStarterQuestions(empty)).toEqual({ ok: true, value: [] })
    }
  })

  it('strips control characters and keeps each question on its own line as plain text', () => {
    const result = normalizeStarterQuestions('Hel\u0000lo\u0007 there\t friend')
    expect(result).toEqual({ ok: true, value: ['Hello there friend'] })
    // Markup is kept as typed text: the widget draws it as text, never as HTML.
    expect(normalizeStarterQuestions('<img src=x onerror=alert(1)>')).toEqual({
      ok: true,
      value: ['<img src=x onerror=alert(1)>'],
    })
  })

  it('refuses more than four, or any longer than 80 characters, with one plain message', () => {
    expect(normalizeStarterQuestions('a\nb\nc\nd')).toEqual({ ok: true, value: ['a', 'b', 'c', 'd'] })
    expect(normalizeStarterQuestions('a\nb\nc\nd\ne')).toEqual({ ok: false, error: STARTER_QUESTIONS_LIMIT_MESSAGE })
    expect(normalizeStarterQuestions('q'.repeat(80))).toEqual({ ok: true, value: ['q'.repeat(80)] })
    expect(normalizeStarterQuestions('q'.repeat(81))).toEqual({ ok: false, error: STARTER_QUESTIONS_LIMIT_MESSAGE })
  })

  it('refuses a value that is neither text nor a list of text', () => {
    for (const bad of [5, {}, [1, 2], true]) {
      expect(normalizeStarterQuestions(bad)).toEqual({ ok: false, error: 'Invalid starter questions' })
    }
  })

  it('stores as one question per line, or null for none, and reads back the same', () => {
    expect(serializeStarterQuestions(['One', 'Two'])).toBe('One\nTwo')
    expect(serializeStarterQuestions([])).toBeNull()
    expect(readStarterQuestions('One\nTwo')).toEqual(['One', 'Two'])
    expect(readStarterQuestions(null)).toEqual([])
  })

  it('is on unless it is explicitly switched off', () => {
    for (const on of [true, null, undefined, 'true', 'on', '1', '', 'yes', 0, {}]) {
      expect(readStarterEnabled(on), String(on)).toBe(true)
    }
    for (const off of [false, 'false', ' FALSE ', 'off', '0']) {
      expect(readStarterEnabled(off), String(off)).toBe(false)
    }
  })

  it('stores the switch as false when off and null (the default, on) otherwise', () => {
    expect(serializeStarterEnabled(false)).toBe(false)
    expect(serializeStarterEnabled(true)).toBeNull()
  })

  it('reads a hand-edited row defensively: drops oversized lines, caps at four', () => {
    expect(readStarterQuestions('ok\n' + 'x'.repeat(200) + '\na\nb\nc\nd\ne')).toEqual(['ok', 'a', 'b', 'c'])
  })
})
