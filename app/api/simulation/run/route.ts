import { z } from 'zod'
import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { auth } from '@/auth'
import { getDb } from '@/lib/db/drizzle'
import { tickets, DEFAULT_ORG_ID } from '@/lib/db/schema'
import { desc, eq, and } from 'drizzle-orm'
import { chatModel, DEFAULT_CHAT_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { assessAnswer, AUTO_DEFLECT_THRESHOLD } from '@/lib/ai/assess'
import { searchArticles } from '@/lib/db/queries/kb'
import { embedText } from '@/lib/ai/embed'
import { logger } from '@/lib/logger'
import { orgHasFeature, orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'
import { rateLimitShared } from '@/lib/ratelimit'

const MOD = 'api/simulation/run'
const RATE_LIMIT_WINDOW_MS = 60_000

const Schema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(20),
  model: z.string().default(DEFAULT_CHAT_MODEL),
  threshold: z.coerce.number().min(0).max(1).default(AUTO_DEFLECT_THRESHOLD),
})

export interface SimTicketResult {
  id: number
  content: string
  category: string | null
  actualStatus: string
  actualAiDraftStatus: string
  simAnswer: string
  simConfidence: number
  simAnsweredFully: boolean
  simReasoning: string
  simWouldDeflect: boolean
  actualWouldDeflect: boolean
  match: boolean
  durationMs: number
}

export interface SimulationResult {
  config: { count: number; model: string; threshold: number }
  results: SimTicketResult[]
  summary: {
    total: number
    wouldDeflect: number
    deflectRate: number
    actualDeflectRate: number
    matchRate: number
    avgConfidence: number
    avgDurationMs: number
  }
}

export type SimStreamEvent =
  | { type: 'start'; total: number }
  | { type: 'step'; index: number; total: number; step: 'embedding' | 'generating' | 'assessing'; ticketId: number; preview: string }
  | { type: 'ticket_done'; index: number; total: number; result: SimTicketResult }
  | { type: 'done'; summary: SimulationResult['summary']; results: SimTicketResult[]; config: SimulationResult['config'] }
  | { type: 'error'; message: string }

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { body = {} }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })

  const { count, model, threshold } = parsed.data
  const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID

  if (!(await orgHasFeature(orgId, 'simulation'))) {
    return Response.json({ error: 'Simulation is available on the Pro plan and above — upgrade in Billing to use it.' }, { status: 403 })
  }

  // Each run drives up to `count` (max 100) Agent.generate + assessAnswer
  // pairs — real, uncapped LLM spend with no ceiling until now. Rate-limited
  // per org like MCP/Agent API rather than per-call, since this is a manual,
  // session-authenticated dashboard action, not a high-frequency API surface —
  // the realistic abuse vector is rapid repeated large runs, which this stops.
  const orgRateLimitMax = await orgRateLimitPerMinute(orgId)
  const rateLimit = await rateLimitShared(`simulation:${orgId}`, orgRateLimitMax, RATE_LIMIT_WINDOW_MS)
  if (!rateLimit.ok) {
    return Response.json({ error: 'Rate limit exceeded — try again shortly.' }, { status: 429 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SimStreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }

      const rows = await getDb()
        .select()
        .from(tickets)
        .where(and(eq(tickets.orgId, orgId)))
        .orderBy(desc(tickets.createdAt))
        .limit(count)

      if (rows.length === 0) {
        send({ type: 'error', message: 'No tickets found to simulate' })
        controller.close()
        return
      }

      send({ type: 'start', total: rows.length })

      // The model is resolved like every other surface: the workspace's own
      // provider (with the model picked here), or, without one, the included
      // platform chat model, metered to the workspace's chat usage. It is
      // resolved again for every ticket so each generation is checked against
      // the budget, not just the first; the per-ticket KB context is passed
      // as an instructions override on each generate() call.
      const buildAgent = async () => new Agent({
        id: 'simulation-agent',
        name: 'simulation-agent',
        instructions: 'You are a technical support agent. Answer the user\'s question concisely and accurately.',
        model: (await chatModel(model, orgId)) as MastraModelConfig,
      })

      try {
        await buildAgent()
      } catch (err) {
        logger.error('simulation model resolution failed', { module: MOD, orgId, error: err })
        send({
          type: 'error',
          message: err instanceof NoAIProviderConfiguredError
            ? aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model to run a simulation.')
            : 'Failed to resolve an AI model for this org',
        })
        controller.close()
        return
      }

      const results: SimTicketResult[] = []
      // Set when AI becomes unavailable mid-run (for example, included usage
      // is used up): the run stops there and reports the tickets it finished.
      let stoppedBecause: string | null = null

      for (let i = 0; i < rows.length; i++) {
        const ticket = rows[i]
        const preview = ticket.content.slice(0, 80).replace(/\n/g, ' ')
        const t0 = Date.now()

        try {
          const simAgent = await buildAgent()
          let kbContext = ''
          send({ type: 'step', index: i + 1, total: rows.length, step: 'embedding', ticketId: ticket.id, preview })
          try {
            const vec = await embedText(ticket.content, orgId)
            const articles = await searchArticles(vec, 3, orgId)
            if (articles.length) {
              kbContext = `\n\nKnowledge base:\n${articles.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}`
            }
          } catch { /* ignore */ }

          send({ type: 'step', index: i + 1, total: rows.length, step: 'generating', ticketId: ticket.id, preview })
          const { text: simAnswer } = await simAgent.generate(ticket.content, {
            instructions: `You are a technical support agent. Answer the user's question concisely and accurately.${kbContext}`,
          })

          send({ type: 'step', index: i + 1, total: rows.length, step: 'assessing', ticketId: ticket.id, preview })
          const assessment = await assessAnswer(ticket.content, simAnswer, orgId)
          const simWouldDeflect = assessment.confidence >= threshold && assessment.answered_fully
          const actualWouldDeflect = ticket.aiDraftStatus === 'posted'

          const result: SimTicketResult = {
            id: ticket.id,
            content: ticket.content.slice(0, 300),
            category: ticket.category,
            actualStatus: ticket.status,
            actualAiDraftStatus: ticket.aiDraftStatus,
            simAnswer: simAnswer.slice(0, 500),
            simConfidence: assessment.confidence,
            simAnsweredFully: assessment.answered_fully,
            simReasoning: assessment.reasoning,
            simWouldDeflect,
            actualWouldDeflect,
            match: simWouldDeflect === actualWouldDeflect,
            durationMs: Date.now() - t0,
          }
          results.push(result)
          send({ type: 'ticket_done', index: i + 1, total: rows.length, result })
        } catch (err) {
          if (err instanceof NoAIProviderConfiguredError) {
            stoppedBecause = aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model to run a simulation.')
            logger.warn('simulation stopped: AI unavailable', { module: MOD, orgId, completed: results.length })
            break
          }
          logger.error('simulation ticket failed', { module: MOD, ticketId: ticket.id, error: err })
          const result: SimTicketResult = {
            id: ticket.id,
            content: ticket.content.slice(0, 300),
            category: ticket.category,
            actualStatus: ticket.status,
            actualAiDraftStatus: ticket.aiDraftStatus,
            simAnswer: '[error]',
            simConfidence: 0,
            simAnsweredFully: false,
            simReasoning: 'Error during simulation',
            simWouldDeflect: false,
            actualWouldDeflect: ticket.aiDraftStatus === 'posted',
            match: false,
            durationMs: Date.now() - t0,
          }
          results.push(result)
          send({ type: 'ticket_done', index: i + 1, total: rows.length, result })
        }
      }

      if (results.length === 0) {
        send({ type: 'error', message: stoppedBecause ?? 'Simulation produced no results' })
        controller.close()
        return
      }

      const wouldDeflect = results.filter(r => r.simWouldDeflect).length
      const actualDeflected = results.filter(r => r.actualWouldDeflect).length
      const matched = results.filter(r => r.match).length
      const avgConfidence = results.reduce((s, r) => s + r.simConfidence, 0) / results.length
      const avgDurationMs = results.reduce((s, r) => s + r.durationMs, 0) / results.length

      const summary: SimulationResult['summary'] = {
        total: results.length,
        wouldDeflect,
        deflectRate: wouldDeflect / results.length,
        actualDeflectRate: actualDeflected / results.length,
        matchRate: matched / results.length,
        avgConfidence,
        avgDurationMs,
      }

      logger.info('simulation complete', { module: MOD, orgId, total: results.length, matchRate: summary.matchRate })
      send({ type: 'done', summary, results, config: { count, model, threshold } })
      // The client shows the partial results above, then this reason.
      if (stoppedBecause) send({ type: 'error', message: stoppedBecause })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}
