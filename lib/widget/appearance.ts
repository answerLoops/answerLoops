// How a workspace on Pro or above makes its website chat widget look like its
// own: the title in the chat header, the welcome message, and a brand color.
// Shared by the settings action, the query layer, the config lookup, the chat
// panel and the settings UI so the limits and the color rules cannot drift
// between a server check and a client control.
//
// Everything here is display only. Title and welcome message are plain text,
// and the brand color is reduced to a plain `#rrggbb`: the chat panel and the
// embed script only ever receive values produced by this file, never the raw
// text someone typed.
//
// See content/docs/product/chat-widget.mdx, "Widget appearance".

export const WIDGET_TITLE_MAX_CHARS = 60
export const WIDGET_WELCOME_MAX_CHARS = 200

/** The answerLoops blue (`brand-600` in app/globals.css), used when nothing is chosen. */
export const DEFAULT_WIDGET_BRAND_COLOR = '#2563eb'

export type AppearanceTextResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

function cleanPlainText(raw: string): string {
  return (
    raw
      // Line breaks and tabs become spaces: both fields are a single short
      // line of text in the widget.
      .replace(/[\r\n\t]+/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/ {2,}/g, ' ')
      .trim()
  )
}

function normalizeText(raw: unknown, label: string, max: number): AppearanceTextResult {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `Invalid ${label}` }
  const cleaned = cleanPlainText(raw)
  if (cleaned.length === 0) return { ok: true, value: null }
  if (cleaned.length > max) return { ok: false, error: `Keep the ${label} under ${max} characters` }
  return { ok: true, value: cleaned }
}

/** Cleans the chat title before it is stored. Empty means "use the default". */
export function normalizeWidgetTitle(raw: unknown): AppearanceTextResult {
  return normalizeText(raw, 'chat title', WIDGET_TITLE_MAX_CHARS)
}

/** Cleans the welcome message before it is stored. Empty means "use the default". */
export function normalizeWidgetWelcome(raw: unknown): AppearanceTextResult {
  return normalizeText(raw, 'welcome message', WIDGET_WELCOME_MAX_CHARS)
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Only a full six-digit hex color qualifies: no shorthand, names or functions. */
export function isValidBrandColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

export type BrandColorResult = { ok: true; value: string | null } | { ok: false; error: string }

/** Cleans a color before it is stored: lowercased, or null for "use the default". */
export function normalizeBrandColor(raw: unknown): BrandColorResult {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Choose a color like #1a73e8.' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (!isValidBrandColor(trimmed)) return { ok: false, error: 'Choose a color like #1a73e8.' }
  return { ok: true, value: trimmed.toLowerCase() }
}

// ---- Color math -------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function channelLuminance(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** WCAG contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export const ON_BRAND_LIGHT = '#ffffff'
export const ON_BRAND_DARK = '#111827'

/**
 * The text color to put on top of a brand color: white or near-black, whichever
 * reads better. Chosen by contrast, so an owner cannot end up with text that is
 * hard to read, whatever color they pick.
 */
export function readableTextColor(background: string): string {
  return contrastRatio(background, ON_BRAND_LIGHT) >= contrastRatio(background, ON_BRAND_DARK)
    ? ON_BRAND_LIGHT
    : ON_BRAND_DARK
}

// How far each step moves from the chosen color. Lighter steps cover this
// share of the distance from the color's lightness up to near-white; darker
// steps keep this share of the color's own lightness. Both are relative to the
// chosen color, so a very dark or a very pale color still gets distinct hover
// and tint shades. 600 is not listed: it is the chosen color itself.
const LIGHTER_STEPS: Array<[string, number]> = [
  ['500', 0.12],
  ['400', 0.3],
  ['300', 0.5],
  ['200', 0.72],
  ['100', 0.86],
  ['50', 0.93],
]
const DARKER_STEPS: Array<[string, number]> = [
  ['700', 0.84],
  ['800', 0.68],
  ['900', 0.52],
  ['950', 0.34],
]
const NEAR_WHITE = 0.97

export type BrandPalette = Record<string, string>

/**
 * The `--brand-*` tokens the chat panel overrides to take on a brand color.
 * `--brand-600` is exactly the chosen color; lighter steps run up to near-white
 * and darker steps down toward near-black, keeping the hue. `--brand-on` is the
 * readable text color for text on `--brand-600`. Every value is generated
 * `#rrggbb`; nothing typed by a person is passed through.
 */
export function brandPalette(color: string): BrandPalette {
  const base = isValidBrandColor(color) ? color.toLowerCase() : DEFAULT_WIDGET_BRAND_COLOR
  const [r, g, b] = hexToRgb(base)
  const [h, s, l] = rgbToHsl(r, g, b)
  const palette: BrandPalette = { '--brand-600': base }

  const at = (lightness: number): string => rgbToHex(...hslToRgb(h, s, lightness))

  for (const [step, share] of LIGHTER_STEPS) {
    palette[`--brand-${step}`] = at(l + (Math.max(NEAR_WHITE, l) - l) * share)
  }
  for (const [step, keep] of DARKER_STEPS) {
    palette[`--brand-${step}`] = at(l * keep)
  }
  palette['--brand-on'] = readableTextColor(base)
  return palette
}

export interface WidgetAppearance {
  title: string | null
  welcome: string | null
  brandColor: string | null
}

export const EMPTY_WIDGET_APPEARANCE: WidgetAppearance = {
  title: null,
  welcome: null,
  brandColor: null,
}

/**
 * Reads stored values defensively: anything that would not pass the write-side
 * checks is treated as not set, so a hand-edited row can never put oversized
 * text or an unusable color into a live widget.
 */
export function readWidgetAppearance(stored: {
  title?: unknown
  welcome?: unknown
  brandColor?: unknown
}): WidgetAppearance {
  const title = normalizeWidgetTitle(stored.title)
  const welcome = normalizeWidgetWelcome(stored.welcome)
  const color = normalizeBrandColor(stored.brandColor)
  return {
    title: title.ok ? title.value : null,
    welcome: welcome.ok ? welcome.value : null,
    brandColor: color.ok ? color.value : null,
  }
}
