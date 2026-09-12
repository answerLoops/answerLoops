import { CopilotRuntime, BuiltInAgent, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2'
import type { BuiltInAgentAISDKFactoryConfig } from '@copilotkit/runtime/v2'

// Not separately exported by the package — pulled out of the one factory
// config type that does export it, rather than duplicating its shape here.
type AgentFactoryContext = Parameters<BuiltInAgentAISDKFactoryConfig['factory']>[0]
import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { chatModel, DEFAULT_FAST_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { embedText } from '@/lib/ai/embed'
import { getKBContext } from '@/lib/db/queries/kb'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import { getWidgetChatMemory } from '@/lib/ai/memory'
import { rateLimitShared } from '@/lib/ratelimit'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { reserveGeneration, commitDeflection, releaseGeneration } from '@/lib/billing/usage'
import { logger } from '@/lib/logger'

const MOD = 'api/widget/chat'

// Per-IP+token: catches a single abusive visitor. Per-token: caps total cost
// exposure for one org even if the IP rotates (proxies, mobile networks, botnets).
const IP_TOKEN_MAX = 20
const IP_TOKEN_WINDOW_MS = 60_000
const TOKEN_MAX = 100
const TOKEN_WINDOW_MS = 60_000

// Applies to every request regardless of envelope method or shape — the
// per-token limits below only run once a request is known to be a
// well-formed agent/run call with a real widgetToken, so without this a
// request shaped any other way (missing `method`, a non-"agent/run" method,
// or simply malformed) would reach the CopilotKit runtime completely
// unthrottled. Generous relative to IP_TOKEN_MAX since it also has to admit
// this widget's own legitimate non-run traffic (e.g. the runtime's info
// handshake).
const GLOBAL_IP_MAX = 60
const GLOBAL_IP_WINDOW_MS = 60_000

// Each message is capped well above normal chat length; the whole array is
// capped so a caller can't send thousands of messages to inflate model cost.
const MAX_MESSAGE_CHARS = 4_000
const MAX_MESSAGES = 50

// A client-generated UUID (36 chars) is the expected shape; capped generously
// above that so a malformed value can't be used to inflate the memory key.
const MAX_VISITOR_ID_LEN = 100

// 50 messages x 4000 chars is the largest legitimate payload; 512KB leaves room
// for the JSON envelope. Enforced while the body streams in rather than after,
// so the cap holds regardless of what the request claims about its length.
const MAX_BODY_BYTES = 512 * 1024

// How many knowledge-base articles are put in front of the model per answer.
const MAX_CONTEXT_ARTICLES = 5

// Widget tokens are crypto.randomBytes(24).toString('hex') — see
// lib/db/queries/widgets.ts. Validated before the token is used as rate-limit
// bucket key material, since the limiter persists that key and cannot bound
// what it is given.
const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

// The per-part cap alone bounds nothing in principle — concatenated parts
// could multiply straight through it — but AG-UI messages carry a single
// `content` string, not the AI SDK's multi-part shape, so this is also the
// whole-message cap.
const MAX_QUERY_CHARS = MAX_MESSAGE_CHARS

export interface PendingRun {
  org: { id: number; name: string }
  model: Awaited<ReturnType<typeof chatModel>>
  query: string
  visitorId: string
  reservationId: number
}

// Validated request context, handed from the `onRequest` hook to the AI SDK
// factory below by reference (org rows and resolved model objects aren't
// JSON-serializable, so they can't ride in `forwardedProps` itself — only this
// map's key does). Entries are one-shot and self-expire so a run that never
// reaches the factory (client disconnect, runtime error before dispatch)
// can't leak.
const pendingRuns = new Map<string, PendingRun>()
export const PENDING_RUN_TTL_MS = 30_000

// Exported for direct unit testing of the stash/expiry/release logic in
// isolation — driving it through the full POST handler under fake timers
// gets tangled in CopilotKit's own RxJS-based event scheduling, which faked
// timers stall in ways unrelated to what's actually being tested here.
export function stashPendingRun(run: PendingRun): string {
  const requestId = crypto.randomUUID()
  pendingRuns.set(requestId, run)
  // The reservation is only recoverable here, at the moment expiry is known
  // to mean "never consumed" — takePendingRun's own miss branch has nothing
  // left to release by then, since the whole point of a miss is that the
  // entry (and the reservationId inside it) is already gone. Checking `has`
  // before deleting guards the ordinary case where the run completed just
  // under the wire: takePendingRun already deleted the entry, so this timeout
  // finds nothing and does not double-release a reservation that onFinish
  // (or the NoAIProviderConfiguredError branch) already resolved.
  setTimeout(() => {
    if (!pendingRuns.has(requestId)) return
    pendingRuns.delete(requestId)
    releaseGeneration(run.reservationId).catch((e) => {
      logger.error('widget chat: releasing an expired, never-dispatched reservation failed', {
        module: MOD,
        orgId: run.org.id,
        error: e,
      })
    })
  }, PENDING_RUN_TTL_MS)
  return requestId
}

export function takePendingRun(requestId: unknown): PendingRun | undefined {
  if (typeof requestId !== 'string') return undefined
  const run = pendingRuns.get(requestId)
  pendingRuns.delete(requestId)
  return run
}

interface RunAgentInputLike {
  threadId?: string
  messages?: { role?: string; content?: string }[]
  forwardedProps?: { widgetToken?: string; visitorId?: string; requestId?: string }
}

interface SingleRouteEnvelope {
  method?: string
  params?: Record<string, unknown>
  body?: RunAgentInputLike
}

function rebuildRequest(request: Request, bodyText: string): Request {
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyText,
    signal: request.signal,
  })
}

async function validateAndPrepare(request: Request): Promise<Response | Request> {
  // Rejects requests that bypassed our edge proxy, before clientIp() below
  // trusts the proxy-supplied client-IP header — see lib/http/origin-guard.ts.
  // No-op until ORIGIN_VERIFY_SECRET is set.
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  // Read (and cap) the body directly rather than via request.clone(): Node's
  // fetch implements clone() by tee()-ing the stream, and canceling one
  // branch — which readBodyCapped does once the cap trips — blocks forever
  // waiting on the other, unread branch. Reading the original once and
  // rebuilding the outgoing Request from that text avoids the tee() entirely
  // and is also simply the request body, so nothing downstream needs it.
  const raw = await readBodyCapped(request, MAX_BODY_BYTES)
  if (raw === null) return new Response('Request body too large', { status: 413 })

  // Every request pays this toll before anything about its shape is trusted
  // — including malformed JSON and non-"agent/run" methods, both of which
  // skip the widgetToken-keyed limits below. Without this, any request that
  // simply doesn't look like a chat run reaches the CopilotKit runtime with
  // no rate limiting at all.
  const ip = clientIp(request)
  const globalIpLimit = await rateLimitShared(`widget-any:${ip}`, GLOBAL_IP_MAX, GLOBAL_IP_WINDOW_MS)
  if (!globalIpLimit.ok) {
    return new Response('Too many requests', { status: 429 })
  }

  let envelope: SingleRouteEnvelope
  try {
    envelope = JSON.parse(raw || '{}')
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Everything other than a chat run (info, thread listing, etc.) passes
  // through as-is — this widget's client only ever issues agent/run. The
  // original request's body is already consumed above, so this still has to
  // be a fresh Request built from the text just read, not `request` itself.
  // The global IP limit above still applies to it.
  if (envelope.method !== 'agent/run') return rebuildRequest(request, raw)

  const body = envelope.body
  const widgetToken = body?.forwardedProps?.widgetToken
  const visitorId = body?.forwardedProps?.visitorId
  const messages = body?.messages

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
  const wellFormed = messages.every(
    (m) => m !== null && typeof m === 'object' && typeof m.role === 'string' && typeof m.content === 'string'
  )
  if (!wellFormed) {
    return new Response('Malformed messages', { status: 400 })
  }
  // Only the newest user message is ever read below, but every message still
  // counts toward MAX_BODY_BYTES — bounding each one here means a large
  // earlier message can't eat most of that budget while a tiny final message
  // sails through the query-length check on its own.
  const oversized = messages.some((m) => (m.content as string).length > MAX_MESSAGE_CHARS)
  if (oversized) {
    return new Response('Message too long', { status: 400 })
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
  // own iframe, so it is same-origin to us and its Origin header is our own
  // hostname — the embedding page's identity is not present on it. The
  // allowlist is enforced at the iframe navigation instead (see
  // app/widget/[widgetToken]/page.tsx).

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const query = lastUserMsg?.content ?? ''
  if (!query.trim()) {
    return new Response('No valid messages', { status: 400 })
  }
  if (query.length > MAX_QUERY_CHARS) {
    return new Response('Message too long', { status: 400 })
  }

  // Reserved before any model work starts — same atomic quota path as
  // generate_answer (MCP/Agent API). The widget's own per-token/per-IP rate
  // limits above throttle abuse rate but never enforced the org's actual
  // monthly deflection allowance, so a plan's cap was unmetered here.
  const reservation = await reserveGeneration(org.id)
  if (!reservation.granted) {
    return new Response('Monthly usage limit reached', { status: 402 })
  }

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

  const requestId = stashPendingRun({ org, model, query, visitorId, reservationId: reservation.generationId })

  const rewritten: SingleRouteEnvelope = {
    ...envelope,
    body: {
      ...body,
      forwardedProps: { ...body?.forwardedProps, requestId },
    },
  }
  return rebuildRequest(request, JSON.stringify(rewritten))
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
async function runWidgetAgent(ctx: AgentFactoryContext) {
  const requestId = (ctx.input.forwardedProps as { requestId?: string } | undefined)?.requestId
  const run = takePendingRun(requestId)
  if (!run) {
    throw new Error('widget chat: run context expired or missing — retry the request')
  }
  const { org, model, query, visitorId, reservationId } = run

  let allContext: { summary: string; answer: string }[] = []
  try {
    const vector = await embedText(query, org.id)
    allContext = await getKBContext(vector, MAX_CONTEXT_ARTICLES, org.id)
  } catch {
    // Proceed without context if embedding fails
  }
  const contextBlock = allContext.length
    ? `\n\nKnowledge base context — use this to answer. When your answer draws from one of these, end your response with a "Source:" line citing the article title:\n${allContext
        .map((c, i) => `${i + 1}. Title: "${c.summary}"\n   Answer: ${c.answer}`)
        .join('\n')}`
    : ''

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
      await commitDeflection(org.id, reservationId).catch((e) => {
        logger.error('widget chat commitDeflection failed', { module: MOD, orgId: org.id, error: e })
      })
    },
  })

  // Mastra's fullStream is typed against Node's `stream/web` ReadableStream,
  // not the DOM lib global the factory's return type expects — same
  // structurally-identical-but-nominally-distinct type gap the old route had
  // at its createTextStreamResponse boundary. Cast at this one boundary.
  return { fullStream: result.fullStream as unknown as AsyncIterable<unknown> }
}

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ type: 'aisdk', factory: runWidgetAgent }),
  },
})

const handler = createCopilotRuntimeHandler({
  runtime,
  mode: 'single-route',
  hooks: {
    onRequest: async (ctx) => {
      const result = await validateAndPrepare(ctx.request)
      if (result instanceof Response) throw result
      return result
    },
  },
})

export const POST = handler
