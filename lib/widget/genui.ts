import { z } from 'zod'

/**
 * Closed catalog of rich components the widget assistant can show.
 *
 * The model never emits markup or code — it fills in these typed slots, and
 * the widget renders them with prebuilt components. Every schema is
 * length-bounded so a runaway generation can't blow up the layout, and the
 * same schemas run twice: on the server when a tool executes (see
 * genui-tools.ts, which also checks that links and contact values come from the
 * knowledge base) and again on the client before anything is drawn, so a
 * payload only ever draws if it matches a shape the catalog defines.
 */

export const GENUI_TOOL_NAMES = {
  steps: 'show_steps',
  choices: 'show_choices',
  callout: 'show_callout',
  linkCard: 'show_link_card',
  contact: 'show_contact_options',
} as const

export const stepsSchema = z.object({
  title: z.string().min(1).max(80),
  steps: z
    .array(z.object({ title: z.string().min(1).max(100), detail: z.string().max(300).optional() }))
    .min(2)
    .max(8),
})

export const choicesSchema = z.object({
  prompt: z.string().min(1).max(160),
  options: z.array(z.object({ label: z.string().min(1).max(60) })).min(2).max(5),
})

export const calloutSchema = z.object({
  tone: z.enum(['info', 'warning', 'success']),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(400),
})

export const linkCardSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(240).optional(),
  url: z.string().min(1).max(500),
  cta: z.string().max(30).optional(),
})

export const contactSchema = z.object({
  message: z.string().min(1).max(240),
  options: z
    .array(
      z.object({
        kind: z.enum(['email', 'phone', 'url']),
        label: z.string().min(1).max(40),
        value: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(3),
})

export type StepsData = z.infer<typeof stepsSchema>
export type ChoicesData = z.infer<typeof choicesSchema>
export type CalloutData = z.infer<typeof calloutSchema>
export type LinkCardData = z.infer<typeof linkCardSchema>
export type ContactData = z.infer<typeof contactSchema>

/**
 * What a genui tool returns to the stream: either the sanitized payload to
 * draw, or `ok: false` meaning "draw nothing" (the model asked for something
 * the guard refused). The renderer only ever draws `data` from a result — never
 * the raw tool-call arguments the model produced.
 */
export type GenuiResult<T> = { ok: true; data: T } | { ok: false }

const EMAIL_PATTERN = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/
const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{5,24}$/

/**
 * Turns a model-supplied URL into an href that is safe to put on an anchor,
 * or null. https only (no http, javascript:, data:, protocol-relative), no
 * embedded credentials. Returned in normalised form so callers compare and
 * render the same string.
 */
export function safeHttpsUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url.toString()
}

/** href for a contact option, or null when the value doesn't fit its kind. */
export function safeContactHref(kind: 'email' | 'phone' | 'url', value: string): string | null {
  const v = value.trim()
  if (kind === 'url') return safeHttpsUrl(v)
  if (kind === 'email') return EMAIL_PATTERN.test(v) ? `mailto:${v}` : null
  return PHONE_PATTERN.test(v) ? `tel:${v.replace(/[^\d+]/g, '')}` : null
}

/** Parses a tool-result string back into a catalog payload, or null. */
export function parseGenuiResult<S extends z.ZodType>(raw: unknown, schema: S): z.infer<S> | null {
  if (typeof raw !== 'string') return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object' || (json as { ok?: unknown }).ok !== true) return null
  const parsed = schema.safeParse((json as { data?: unknown }).data)
  return parsed.success ? parsed.data : null
}
