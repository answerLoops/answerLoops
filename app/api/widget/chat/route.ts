import { createTextStreamResponse } from 'ai'
import type { UIMessage } from 'ai'
import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { chatModel, DEFAULT_FAST_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { embedText } from '@/lib/ai/embed'
import { getKBContext } from '@/lib/db/queries/kb'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import { getWidgetChatMemory } from '@/lib/ai/memory'
import { rateLimitShared } from '@/lib/ratelimit'
import { clientIp } from '@/lib/http/client-ip'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { reserveGeneration, commitDeflection, releaseGeneration } from '@/lib/billing/usage'
import { logger } from '@/lib/logger'
import { WIDGET_LEAD_SIGNAL_HEADER, requestsHuman, type WidgetLeadSignal } from '@/lib/widget/lead-capture'

const MOD = 'api/widget/chat'

// Per-IP+token: catches a single abusive visitor. Per-token: caps total cost
// exposure for one org even if the IP rotates (proxies, mobile networks, botnets).
const IP_TOKEN_MAX = 20
const IP_TOKEN_WINDOW_MS = 60_000
const TOKEN_MAX = 100
const TOKEN_WINDOW_MS = 60_000

// Each message is capped well above normal chat length; the whole array is
// capped so a caller can't send thousands of messages to inflate model cost.
const MAX_MESSAGE_CHARS = 4_000
const MAX_MESSAGES = 50

// 50 messages x 4000 chars is the largest legitimate payload; 512KB leaves room
// for the JSON envelope. Enforced while the body streams in rather than after,
// so the cap holds regardless of what the request claims about its length.
const MAX_BODY_BYTES = 512 * 1024

// A client-generated UUID (36 chars) is the expected shape; capped generously
// above that so a malformed value can't be used to inflate the memory key.
const MAX_VISITOR_ID_LEN = 100

// How many knowledge-base articles are put in front of the model per answer.
const MAX_CONTEXT_ARTICLES = 5

// Widget tokens are crypto.randomBytes(24).toString('hex') — see
// lib/db/queries/widgets.ts. Validated before the token is used as rate-limit
// bucket key material, since the limiter persists that key and cannot bound
// what it is given.
const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

// The per-part cap alone bounds nothing: every text part of the newest user
// message is concatenated before it reaches the model, so N parts just under
// the per-part limit multiply straight through. Both are enforced.
const MAX_QUERY_CHARS = MAX_MESSAGE_CHARS

export async function POST(request: Request) {
  // Rejects requests that bypassed our edge proxy, before clientIp() below
  // trusts the proxy-supplied client-IP header — see lib/http/origin-guard.ts.
  // No-op until ORIGIN_VERIFY_SECRET is set.
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  // Resolved through the trusted-proxy chain rather than read from the raw
  // header — the leftmost x-forwarded-for entry is caller-supplied, so keying
  // the limiter on it let anyone mint a fresh bucket per request.
  const ip = clientIp(request)

  const raw = await readBodyCapped(request, MAX_BODY_BYTES)
  if (raw === null) return new Response('Request body too large', { status: 413 })

  let body: { messages?: unknown[]; widgetToken?: string; visitorId?: string }
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { messages, widgetToken, visitorId } = body
  if (!widgetToken || typeof widgetToken !== 'string' || !WIDGET_TOKEN_PATTERN.test(widgetToken)) {
    return new Response('Missing widgetToken', { status: 400 })
  }
  if (!visitorId || typeof visitorId !== 'string' || visitorId.length > MAX_VISITOR_ID_LEN) {
    return new Response('Missing visitorId', { status: 400 })
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('Missing messages', { status: 400 })
  }
  if (messages.length > MAX_MESSAGES) {
    return new Response('Too many messages', { status: 400 })
  }
  // Elements are shape-checked before anything below reads into them: this is
  // a public endpoint, so an unexpected shape must be a 400 rather than an
  // unhandled error.
  const wellFormed = messages.every(
    (m) =>
      m !== null &&
      typeof m === 'object' &&
      typeof (m as { role?: unknown }).role === 'string' &&
      ((m as { parts?: unknown }).parts === undefined ||
        Array.isArray((m as { parts?: unknown }).parts))
  )
  if (!wellFormed) {
    return new Response('Malformed messages', { status: 400 })
  }

  const tokenLimit = await rateLimitShared(`widget-token:${widgetToken}`, TOKEN_MAX, TOKEN_WINDOW_MS)
  if (!tokenLimit.ok) {
    return new Response('Too many requests', { status: 429 })
  }
  const ipLimit = await rateLimitShared(`widget-ip:${widgetToken}:${ip}`, IP_TOKEN_MAX, IP_TOKEN_WINDOW_MS)
  if (!ipLimit.ok) {
    return new Response('Too many requests', { status: 429 })
  }

  const org = await getOrgByWidgetToken(widgetToken)
  if (!org) {
    return new Response('Invalid widget token', { status: 404 })
  }

  // No origin allowlist here by design. This request is made from inside our
  // own iframe, so it is same-origin to us and its Origin header is our
  // hostname — the embedding page's identity is not present on it. The
  // allowlist is enforced at the iframe navigation instead (see
  // app/widget/[widgetToken]/page.tsx).

  const uiMessages = messages as UIMessage[]
  const oversized = uiMessages.some((m) =>
    m.parts?.some((p) => p.type === 'text' && (p as { text: string }).text.length > MAX_MESSAGE_CHARS)
  )
  if (oversized) {
    return new Response('Message too long', { status: 400 })
  }

  // Conversation history now lives in Mastra memory (keyed by org+visitor,
  // below), not in the client-resent array — only the newest user message
  // matters here. The client still sends the full array for its own local
  // rendering; we just don't need it server-side any more.
  const lastUserMsg = [...uiMessages].reverse().find((m) => m.role === 'user')
  const query = lastUserMsg?.parts
    ?.filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('') ?? ''

  if (!query.trim()) {
    return new Response('No valid messages', { status: 400 })
  }
  // The per-part check above passes for N parts each just under the per-part
  // cap; this bounds what actually reaches the model after concatenation.
  if (query.length > MAX_QUERY_CHARS) {
    return new Response('Message too long', { status: 400 })
  }

  // Reserved before any model work starts — same atomic quota path as
  // generate_answer (MCP/Agent API). The widget's own per-token/per-IP rate
  // limits above throttle abuse rate but never enforced the org's actual
  // monthly deflection allowance, so a plan's cap was unmetered here.
  //
  // Deliberately placed *after* every request-validation branch: attempts are
  // capped at a multiple of the plan's allowance, so a rejected request must
  // not leave one behind. Everything from here on must release the reservation
  // on any path that doesn't reach the model.
  const reservation = await reserveGeneration(org.id)
  if (!reservation.granted) {
    return new Response('Monthly usage limit reached', { status: 402 })
  }

  // Published knowledge-base articles only.
  //
  // Ticket-derived text (resolution_notes/ai_draft) is written for the one
  // person who raised the ticket and routinely contains specifics — names,
  // account and order details, internal reasoning — and the model has no way
  // to tell which parts were meant to stay internal.
  //
  // Promoting a resolved answer into the knowledge base is the human review
  // step that generalises it and strips the specifics; that promotion is what
  // makes content publicly answerable. Ticket-derived context belongs to the
  // internal draft pipeline (lib/ingest/pipeline.ts), which is staff-facing.
  let allContext: { summary: string; answer: string }[] = []

  try {
    const vector = await embedText(query, org.id)
    // Was 4 of 5 slots, with the tail left for a prior answer. With that gone
    // the KB gets the whole budget rather than the budget shrinking.
    allContext = await getKBContext(vector, MAX_CONTEXT_ARTICLES, org.id)
  } catch {
    // Proceed without context if embedding fails
  }
  const contextBlock = allContext.length
    ? `\n\nKnowledge base context — use this to answer. When your answer draws from one of these, end your response with a "Source:" line citing the article title:\n${allContext
        .map((c, i) => `${i + 1}. Title: "${c.summary}"\n   Answer: ${c.answer}`)
        .join('\n')}`
    : ''

  // Surfaced to the widget client as a response header (below) so the
  // on-failure lead-capture prompt (see lib/widget/lead-capture.ts and issue
  // #11) can trigger without the client trying to parse the model's prose.
  // Checked in priority order: an explicit ask for a human is the strongest
  // signal regardless of whether the KB happened to return something.
  const leadSignal: WidgetLeadSignal = requestsHuman(query)
    ? 'human-requested'
    : allContext.length === 0
      ? 'no-kb-match'
      : 'none'

  let model: Awaited<ReturnType<typeof chatModel>>
  try {
    model = await chatModel(DEFAULT_FAST_MODEL, org.id)
  } catch (e) {
    // Reached the reservation but never the model, so the attempt isn't real
    // usage — give the slot back rather than charging the org for its own
    // misconfiguration on every visitor request.
    await releaseGeneration(reservation.generationId)
    if (e instanceof NoAIProviderConfiguredError) {
      logger.warn('widget chat: no AI provider configured', { module: MOD, orgId: org.id })
      // Customer-facing surface — a generic message, not the org-owner-facing
      // "connect a provider" instruction, which would only confuse an end user.
      return new Response('This assistant is temporarily unavailable. Please contact support directly.', { status: 503 })
    }
    throw e
  }

  // resourceId scopes memory to this org+visitor; threadId reuses the same
  // id since the widget has no "start a new conversation" affordance — a
  // visitor has exactly one ongoing thread today.
  const resourceId = `widget:${org.id}:${visitorId}`

  // Agent instantiated per-call — see lib/ai/agent.ts for why (model is
  // resolved per-org, so no single instance is valid across orgs). The
  // memory instance itself IS a shared singleton (lib/ai/memory.ts) — only
  // the Agent wrapper is rebuilt each call.
  const widgetAgent = new Agent({
    id: 'widget-chat-agent',
    name: 'widget-chat-agent',
    instructions: `You are a helpful support assistant for ${org.name}.
Answer questions concisely and accurately based on the knowledge base context provided.
If you don't know the answer or it's not covered in the context, say so honestly and suggest the user contact support directly.
Keep responses brief and friendly. Format with markdown when helpful.
Respond in the same language as the user's question — if they write in Spanish, reply in Spanish; French, reply in French; etc.
Cite a source only when your answer actually draws on one of the numbered knowledge base articles below. When you do, end your response with a line in exactly this format, substituting the article's real Title in place of the placeholder — never emit the placeholder text itself:
📚 *Source: <Title of the article you used>*
If no article below covers the question, answer from general knowledge and do not add a Source line at all.${contextBlock}`,
    model: model as MastraModelConfig,
    memory: getWidgetChatMemory(),
  })

  const result = await widgetAgent.stream(query, {
    memory: { thread: resourceId, resource: resourceId },
    modelSettings: { maxOutputTokens: 600 },
    // Billed unconditionally once the stream completes — this endpoint has
    // no confidence-assessment step like the MCP/ticket pipelines do, so a
    // delivered answer is the bar for what counts as a deflection here.
    onFinish: async () => {
      await commitDeflection(org.id, reservation.generationId).catch((e) => {
        logger.error('widget chat commitDeflection failed', { module: MOD, orgId: org.id, error: e })
      })
    },
  })

  // Mastra's textStream is typed against Node's `stream/web` ReadableStream,
  // not the DOM lib global `createTextStreamResponse` expects — same
  // structurally-identical-but-nominally-distinct type gap as the
  // MastraModelConfig cast above. Cast at this one boundary.
  return createTextStreamResponse({
    textStream: result.textStream as unknown as ReadableStream<string>,
    headers: { [WIDGET_LEAD_SIGNAL_HEADER]: leadSignal },
  })
}
