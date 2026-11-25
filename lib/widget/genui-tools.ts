import { createTool } from '@mastra/core/tools'
import {
  GENUI_TOOL_NAMES,
  calloutSchema,
  choicesSchema,
  contactSchema,
  followUpsSchema,
  linkCardSchema,
  safeContactHref,
  safeHttpsUrl,
  stepsSchema,
  type GenuiResult,
} from '@/lib/widget/genui'

/**
 * Mastra tools behind the widget's rich components.
 *
 * Each tool is display-only: it has no side effects and reaches no external
 * system. What it does is the server half of the safety story — the model
 * proposes a component, and `execute` decides what actually reaches the
 * visitor. Links and contact details are only allowed through when they appear
 * verbatim in the knowledge-base context this answer was grounded in, so the
 * model can't invent a URL, email or phone number and present it in an
 * official-looking card. The client renders the *result*, not the arguments.
 */

const normalise = (s: string) => s.toLowerCase().replace(/\/+$/, '')
const digitsOnly = (s: string) => s.replace(/\D/g, '')

/** Whether a URL, email or phone number is present in the grounded KB text. */
function makeGroundingCheck(groundedText: string) {
  const haystack = normalise(groundedText)
  const haystackDigits = digitsOnly(groundedText)
  return {
    url(url: string): boolean {
      return haystack.includes(normalise(url))
    },
    email(email: string): boolean {
      return haystack.includes(email.trim().toLowerCase())
    },
    phone(phone: string): boolean {
      const d = digitsOnly(phone)
      return d.length >= 6 && haystackDigits.includes(d)
    },
  }
}

const ok = <T>(data: T): GenuiResult<T> => ({ ok: true, data })
const refused: GenuiResult<never> = { ok: false }

const USAGE = `Use at most one component per reply, only when it is clearly clearer than plain text, and keep any accompanying text to a sentence or two.`

export interface GenuiToolOptions {
  /**
   * Present only when follow-up suggestions are available for this workspace:
   * without it the show_follow_ups tool does not exist, so the assistant cannot
   * call it. `ground` keeps the suggestions the knowledge base can answer
   * (lib/widget/follow-ups.ts) and returns none when fewer than two qualify.
   */
  followUps?: { ground: (labels: string[]) => Promise<string[]> }
}

/**
 * @param groundedText the knowledge-base context block the answer is built
 *   from — the only source links and contact details may come from. Pass a
 *   function when the context can grow during the turn (the model's own
 *   searches add articles); it is read again on every card call, so a link
 *   from an article found mid-turn is allowed and nothing else is.
 */
export function buildGenuiTools(groundedText: string | (() => string), options: GenuiToolOptions = {}) {
  const grounding = () => makeGroundingCheck(typeof groundedText === 'function' ? groundedText() : groundedText)
  const followUps = options.followUps

  return {
    [GENUI_TOOL_NAMES.steps]: createTool({
      id: GENUI_TOOL_NAMES.steps,
      description: `Show a numbered step-by-step guide card (setup, how-to, troubleshooting sequence). ${USAGE}`,
      inputSchema: stepsSchema,
      execute: async (input) => ok(stepsSchema.parse(input)),
    }),

    [GENUI_TOOL_NAMES.choices]: createTool({
      id: GENUI_TOOL_NAMES.choices,
      description: `Show tappable quick-reply buttons when the question is ambiguous and 2-5 short options would narrow it down. The visitor's tap is sent back as their next message. ${USAGE}`,
      inputSchema: choicesSchema,
      execute: async (input) => ok(choicesSchema.parse(input)),
    }),

    [GENUI_TOOL_NAMES.callout]: createTool({
      id: GENUI_TOOL_NAMES.callout,
      description: `Show a highlighted note: an important warning, a tip, or a confirmation. ${USAGE}`,
      inputSchema: calloutSchema,
      execute: async (input) => ok(calloutSchema.parse(input)),
    }),

    [GENUI_TOOL_NAMES.linkCard]: createTool({
      id: GENUI_TOOL_NAMES.linkCard,
      description: `Show a card linking to a page. Only use a URL that appears in the knowledge base context; any other URL is discarded. ${USAGE}`,
      inputSchema: linkCardSchema,
      execute: async (input) => {
        const parsed = linkCardSchema.parse(input)
        const url = safeHttpsUrl(parsed.url)
        if (!url || !grounding().url(parsed.url)) return refused
        return ok({ ...parsed, url })
      },
    }),

    [GENUI_TOOL_NAMES.contact]: createTool({
      id: GENUI_TOOL_NAMES.contact,
      description: `Show contact options (email, phone, support page) when the visitor needs a human or the knowledge base can't answer. Only use values that appear in the knowledge base context; any other value is discarded. ${USAGE}`,
      inputSchema: contactSchema,
      execute: async (input) => {
        const parsed = contactSchema.parse(input)
        const grounded = grounding()
        const options = parsed.options.filter((o) => {
          if (!safeContactHref(o.kind, o.value)) return false
          if (o.kind === 'email') return grounded.email(o.value)
          if (o.kind === 'phone') return grounded.phone(o.value)
          return grounded.url(o.value)
        })
        if (options.length === 0) return refused
        return ok({ ...parsed, options })
      },
    }),

    // Only when the workspace has follow-up suggestions available (see options).
    ...(followUps
      ? {
          [GENUI_TOOL_NAMES.followUps]: createTool({
            id: GENUI_TOOL_NAMES.followUps,
            description: `Show two or three short questions the visitor might ask next, as tappable buttons, after a helpful answer. Only suggest questions the knowledge base context can answer; any others are discarded. Never after a short factual answer, a refusal, an "I don't know", a contact or support answer, or in a reply that already has another card. ${USAGE}`,
            inputSchema: followUpsSchema,
            execute: async (input: unknown) => {
              const parsed = followUpsSchema.parse(input)
              const kept = await followUps.ground(parsed.questions.map((q) => q.label))
              if (kept.length < 2) return refused
              return ok({ ...(parsed.prompt ? { prompt: parsed.prompt } : {}), questions: kept.map((label) => ({ label })) })
            },
          }),
        }
      : {}),
  }
}
