import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { chatModel, DEFAULT_CHAT_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { embedText } from '@/lib/ai/embed'
import { searchArticles, getKBContext } from '@/lib/db/queries/kb'
import { getLatestFAQ } from '@/lib/db/queries/faq'
import { getTickets, type TicketCursor } from '@/lib/db/queries/tickets'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { assessAnswer, shouldAutoDeflect } from '@/lib/ai/assess'
import { reserveGeneration, commitDeflection } from '@/lib/billing/usage'
import { logger } from '@/lib/logger'
import type { TicketStatus, Priority, TicketCategory } from '@/types'

/**
 * Core agent-facing business logic — the actual implementation behind both
 * the MCP server (lib/mcp/tools.ts) and the REST Agent API
 * (app/api/v1/agent/*). Each surface only differs in how a request is shaped
 * in/out (JSON-RPC tool call vs. plain REST JSON); the underlying pipeline
 * calls, validation, and error messages must stay identical between them —
 * hence a single implementation here that both wrap, rather than two
 * parallel copies that can silently drift.
 */

const MOD = 'agent/core'

// Response payloads are capped — a caller pays per token on its own end,
// and an unbounded ticket/KB dump is a cost footgun for them (and a way to
// accidentally exfiltrate an org's entire dataset in one call).
export const MAX_RESULTS = 20

// Caps free-text inputs that feed an embedding or LLM call directly — the
// rate limiter caps request *count*, not per-request size, so an uncapped
// query/question is a way to run up real token cost in a single call.
export const MAX_QUERY_LEN = 2000

export const MAX_IDEMPOTENCY_KEY_LEN = 200

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'duplicate'] as const
export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
export const CATEGORIES = ['bug', 'feature_request', 'documentation', 'how_to', 'general_question'] as const

export type CoreResult<T> = { ok: true; data: T } | { ok: false; error: string }

function ok<T>(data: T): CoreResult<T> {
  return { ok: true, data }
}

function err<T>(error: string): CoreResult<T> {
  return { ok: false, error }
}

/**
 * Clamps a caller-supplied limit to [1, MAX_RESULTS]. Anything non-numeric,
 * fractional-weird, zero, or negative falls back to the default — a negative
 * value would otherwise flow into SQL LIMIT and throw.
 */
export function clampLimit(value: unknown, defaultLimit: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return defaultLimit
  return Math.min(n, MAX_RESULTS)
}

/**
 * Returns the value if it's one of the allowed enum members, undefined if the
 * caller omitted it, and null if they sent something invalid. The DB layer
 * parameterizes everything so an arbitrary string is not injectable, but
 * silently filtering on a nonsense value returns misleading empty results —
 * reject it instead.
 */
export function parseEnumArg<T extends string>(value: unknown, allowed: readonly T[]): T | undefined | null {
  if (value === undefined) return undefined
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

// ── search_kb ────────────────────────────────────────────────────────────

export interface SearchKbResult {
  question: string
  answer: string
  score: number
}

export async function searchKbCore(orgId: number, args: Record<string, unknown>): Promise<CoreResult<SearchKbResult[]>> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return err('query is required')
  if (query.length > MAX_QUERY_LEN) return err(`query must be ${MAX_QUERY_LEN} characters or fewer`)
  const limit = clampLimit(args.limit, 5)

  let vector: number[]
  try {
    vector = await embedText(query, orgId)
  } catch (e) {
    if (e instanceof NoAIProviderConfiguredError) {
      return err('No AI provider configured for this org — connect one in Settings → AI Model.')
    }
    throw e
  }
  const results = await searchArticles(vector, limit, orgId)
  return ok(results.map((r) => ({ question: r.question, answer: r.answer, score: Number(r.score.toFixed(3)) })))
}

// ── get_faq ──────────────────────────────────────────────────────────────

export interface FaqResult {
  message?: string
  week_start?: string
  week_end?: string
  ticket_count?: number
  content?: string
}

export async function getFaqCore(orgId: number): Promise<CoreResult<FaqResult>> {
  const faq = await getLatestFAQ(orgId)
  if (!faq) return ok({ message: 'No FAQ has been generated for this organization yet.' })
  return ok({
    week_start: faq.week_start,
    week_end: faq.week_end,
    ticket_count: faq.ticket_count,
    content: faq.content,
  })
}

// ── get_tickets ──────────────────────────────────────────────────────────

export interface TicketSummary {
  id: number
  content: string
  category: string | null
  priority: string
  status: string
  ai_summary: string | null
  created_at: string
}

export interface TicketsPage {
  tickets: TicketSummary[]
  /** Pass back as `cursor` to fetch the next page; null once there isn't one. */
  next_cursor: string | null
}

/**
 * Opaque, forward-only cursor over the (created_at, id) ordering getTickets
 * sorts by. Base64url rather than a raw "timestamp|id" string so callers
 * treat it as opaque (matching every other keyset-paginated API) instead of
 * building assumptions about its internal shape into their own code.
 */
function encodeTicketCursor(cursor: TicketCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url')
}

/**
 * Returns `undefined` when the caller omitted `cursor` (first page), `null`
 * when they sent one that doesn't decode to a valid cursor — the caller
 * distinguishes "no cursor" from "bad cursor" the same way `parseEnumArg` does.
 */
function decodeTicketCursor(value: unknown): TicketCursor | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value) return null
  let decoded: string
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const sep = decoded.lastIndexOf('|')
  if (sep === -1) return null
  const createdAt = decoded.slice(0, sep)
  const id = Number(decoded.slice(sep + 1))
  if (!createdAt || !Number.isInteger(id)) return null
  return { createdAt, id }
}

export async function getTicketsCore(orgId: number, args: Record<string, unknown>): Promise<CoreResult<TicketsPage>> {
  const limit = clampLimit(args.limit, 10)
  const status = parseEnumArg<TicketStatus>(args.status, TICKET_STATUSES)
  const priority = parseEnumArg<Priority>(args.priority, PRIORITIES)
  const category = parseEnumArg<TicketCategory>(args.category, CATEGORIES)
  if (status === null) return err(`status must be one of: ${TICKET_STATUSES.join(', ')}`)
  if (priority === null) return err(`priority must be one of: ${PRIORITIES.join(', ')}`)
  if (category === null) return err(`category must be one of: ${CATEGORIES.join(', ')}`)

  const cursor = decodeTicketCursor(args.cursor)
  if (cursor === null) return err('cursor is invalid or malformed')

  // Fetch one row past the page so whether another page follows is known
  // without a second round trip or a separate COUNT query.
  const rows = await getTickets({ status, priority, category }, orgId, limit + 1, cursor)
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  const next_cursor = hasMore && last ? encodeTicketCursor({ createdAt: last.created_at, id: last.id }) : null

  return ok({
    tickets: page.map((t) => ({
      id: t.id,
      content: t.content,
      category: t.category,
      priority: t.priority,
      status: t.status,
      ai_summary: t.ai_summary,
      created_at: t.created_at,
    })),
    next_cursor,
  })
}

// ── create_ticket ────────────────────────────────────────────────────────

export interface CreateTicketResult {
  ticket_id: number
  duplicate: boolean
}

export interface CreateTicketOpts {
  /**
   * Namespaces idempotency-key-derived messageIds and the authorId so the
   * MCP and REST surfaces can never collide with each other even if a
   * client somehow reused the same idempotencyKey against both — and, more
   * importantly, so refactoring this logic out of lib/mcp/tools.ts never
   * changes the messageId an existing MCP client's stored idempotencyKey
   * derives to (that would silently break its retry-dedup and mint a
   * duplicate ticket the first time it retried post-refactor).
   */
  idPrefix: string
  defaultAuthorName: string
}

export async function createTicketCore(
  orgId: number,
  args: Record<string, unknown>,
  opts: CreateTicketOpts
): Promise<CoreResult<CreateTicketResult>> {
  const content = typeof args.content === 'string' ? args.content.trim() : ''
  if (!content) return err('content is required')
  if (content.length > 4000) return err('content must be 4000 characters or fewer')
  const authorName = typeof args.authorName === 'string' && args.authorName.trim() ? args.authorName.trim() : opts.defaultAuthorName

  const idempotencyKey = typeof args.idempotencyKey === 'string' ? args.idempotencyKey.trim() : ''
  if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LEN) {
    return err(`idempotencyKey must be ${MAX_IDEMPOTENCY_KEY_LEN} characters or fewer`)
  }
  // The pipeline's dedup gate is keyed on messageId (getTicketBySourceMessageId).
  // Without a caller-supplied key, every retry mints a fresh random id and the
  // gate can never fire — a client retrying on timeout opens duplicate tickets
  // and pays for duplicate AI triage. Deriving messageId from the caller's key
  // (namespaced by org, so orgs can't collide with each other's keys) makes
  // retries land on the same ticket instead.
  const messageId = idempotencyKey
    ? `${opts.idPrefix}-${orgId}-${idempotencyKey}`
    : `${opts.idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const result = await processCommunityMessage(
    {
      messageId,
      content,
      authorId: `${opts.idPrefix}:${orgId}`,
      authorName,
      channelId: messageId,
      // Both the MCP tool call and the REST endpoint are the same access
      // class from the dashboard's point of view — an API caller, not a
      // human on a chat channel — so both are tagged the existing 'mcp'
      // source_platform rather than adding a new enum value + ticket-badge
      // variant for a distinction that isn't visible/actionable to staff.
      // The authorId prefix (opts.idPrefix, above) still distinguishes which
      // surface actually created the ticket for anyone querying the DB
      // directly.
      platform: 'mcp',
      // Unlike a live webhook, the API caller has no acknowledgement latency
      // requirement and expects the created ticket to include its AI draft.
      waitForEnrichment: true,
    },
    orgId
  )
  return ok({ ticket_id: result.ticket_id, duplicate: result.duplicate ?? false })
}

// ── generate_answer ──────────────────────────────────────────────────────

export interface GenerateAnswerResult {
  answer: string
  confidence: number
  answered_fully: boolean
  high_confidence: boolean
}

export async function generateAnswerCore(
  orgId: number,
  args: Record<string, unknown>,
  keyId?: number | null
): Promise<CoreResult<GenerateAnswerResult>> {
  const question = typeof args.question === 'string' ? args.question.trim() : ''
  if (!question) return err('question is required')
  if (question.length > MAX_QUERY_LEN) return err(`question must be ${MAX_QUERY_LEN} characters or fewer`)

  // Both ceilings are checked and the usage row written in one locked
  // transaction before any model work starts. Checking first and recording
  // afterwards let concurrent callers all pass a limit they had collectively
  // already reached, and left in-flight calls invisible to each other.
  //
  // Two ceilings, because only high-confidence generations bill as
  // deflections: without the attempt ceiling, a caller whose answers never
  // clear the confidence bar could run embedding + LLM calls indefinitely
  // without moving the billed counter.
  const reservation = await reserveGeneration(orgId, keyId)

  if (!reservation.granted && reservation.reason === 'deflection-limit') {
    const { used, limit } = reservation
    return err(`Monthly deflection limit reached (${used}/${limit}). Upgrade the plan or wait for the next billing cycle before calling generate_answer again.`)
  }

  if (!reservation.granted) {
    const attempts = { used: reservation.used, limit: reservation.limit }
    // Logged at warn because the multiplier behind this ceiling is a judgement
    // call, not a measured one. If real orgs start tripping it, that's the
    // signal to check their high-confidence hit rate in api_generations and
    // retune GENERATION_ATTEMPT_MULTIPLIER — a legitimate org with a thin KB
    // has a low hit rate through no fault of its own, and should not be
    // blocked while still under the deflection allowance it pays for.
    logger.warn('generate_answer attempt limit reached', {
      module: MOD,
      orgId,
      keyId,
      used: attempts.used,
      limit: attempts.limit,
    })
    return err(`Monthly generate_answer call limit reached (${attempts.used}/${attempts.limit}). This counts every call, including low-confidence ones that aren't billed as deflections. Upgrade the plan or wait for the next billing cycle.`)
  }

  let text: string
  try {
    const vector = await embedText(question, orgId)
    const priorAnswers = await getKBContext(vector, 3, orgId)
    const context = priorAnswers.length
      ? `\n\nPrior resolved answers for similar questions — prefer reusing these:\n${priorAnswers.map((p, i) => `${i + 1}. Q: ${p.summary}\n   A: ${p.answer}`).join('\n')}`
      : ''

    // Agent instantiated per-call — see lib/ai/agent.ts for why (model is
    // resolved per-org/per-purpose, so no single instance is valid across orgs).
    const answerAgent = new Agent({
      id: 'generate-answer-agent',
      name: 'generate-answer-agent',
      instructions: `You are a technical support agent. Answer using the knowledge base context provided. Do not invent product-specific details not present in the context — if the context doesn't cover the question, say so honestly instead of guessing. Be concise.${context}`,
      model: (await chatModel(DEFAULT_CHAT_MODEL, orgId)) as MastraModelConfig,
    })
    const result = await answerAgent.generate(question)
    text = result.text
  } catch (e) {
    if (e instanceof NoAIProviderConfiguredError) {
      return err('No AI provider configured for this org — connect one in Settings → AI Model.')
    }
    throw e
  }

  const assessment = await assessAnswer(question, text, orgId).catch((e) => {
    logger.error('generate_answer assessment failed', { module: MOD, orgId, error: e })
    return { confidence: 0, answered_fully: false, reasoning: 'Assessment failed.' }
  })

  const highConfidence = shouldAutoDeflect(assessment)

  // The row was reserved as an attempt before the model ran. Promote it now
  // that confidence is known — only high-confidence calls bill as deflections,
  // mirroring auto_deflected semantics on tickets. Neither calling surface
  // creates a ticket/ai_assessments row like every other channel does, so this
  // is the only thing that counts these calls toward the org's limit.
  if (highConfidence) {
    const billed = await commitDeflection(orgId, reservation.generationId).catch((e) => {
      logger.error('commitDeflection failed', { module: MOD, orgId, error: e })
      return false
    })
    // The org filled its remaining allowance while this call was in flight.
    // The answer still goes back — the spend is already incurred either way —
    // but it stays an unbilled attempt rather than pushing them over the plan.
    if (!billed) {
      logger.warn('generate_answer answered past the deflection allowance, unbilled', {
        module: MOD,
        orgId,
        keyId,
        generationId: reservation.generationId,
      })
    }
  }

  return ok({
    answer: text,
    confidence: Math.round(assessment.confidence * 100),
    answered_fully: assessment.answered_fully,
    high_confidence: highConfidence,
  })
}
