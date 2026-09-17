import {
  searchKbCore,
  getFaqCore,
  getTicketsCore,
  createTicketCore,
  generateAnswerCore,
  TICKET_STATUSES,
  PRIORITIES,
  CATEGORIES,
} from '@/lib/agent/core'
import { logger } from '@/lib/logger'
import { TOOL_SCOPES } from '@/lib/agent/scopes'
import type { McpToolDefinition, McpToolResult } from './protocol'

const MOD = 'mcp/tools'

function textResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// ── search_kb ────────────────────────────────────────────────────────────

const searchKbDef: McpToolDefinition = {
  name: 'search_kb',
  description: "Semantically search the organization's knowledge base (published Q&A articles promoted from resolved support tickets). Use this before answering a question yourself — it's grounded in what this specific community/product has already answered.",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question or topic to search for' },
      limit: { type: 'number', description: 'Max results to return (default 5, max 20)' },
    },
    required: ['query'],
  },
  _meta: { requiredScope: TOOL_SCOPES.search_kb },
}

async function searchKb(orgId: number, args: Record<string, unknown>): Promise<McpToolResult> {
  const result = await searchKbCore(orgId, args)
  return result.ok ? textResult(result.data) : errorResult(result.error)
}

// ── get_faq ──────────────────────────────────────────────────────────────

const getFaqDef: McpToolDefinition = {
  name: 'get_faq',
  description: "Get the organization's most recently generated FAQ digest — a markdown summary of the top questions resolved this week, grouped by category.",
  inputSchema: { type: 'object', properties: {} },
  _meta: { requiredScope: TOOL_SCOPES.get_faq },
}

async function getFaq(orgId: number): Promise<McpToolResult> {
  const result = await getFaqCore(orgId)
  return result.ok ? textResult(result.data) : errorResult(result.error)
}

// ── get_tickets ──────────────────────────────────────────────────────────

const getTicketsDef: McpToolDefinition = {
  name: 'get_tickets',
  description: 'List support tickets for the organization, optionally filtered by status, priority, or category. Returns the most recent tickets first, plus a next_cursor to page through the rest — pass it back as `cursor` to keep going until next_cursor comes back null.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...TICKET_STATUSES] },
      priority: { type: 'string', enum: [...PRIORITIES] },
      category: { type: 'string', enum: [...CATEGORIES] },
      limit: { type: 'number', description: 'Max results per page (default 10, max 20)' },
      cursor: { type: 'string', description: "Opaque value from a previous response's next_cursor. Omit for the first page." },
    },
  },
  _meta: { requiredScope: TOOL_SCOPES.get_tickets },
}

async function getTicketsTool(orgId: number, args: Record<string, unknown>): Promise<McpToolResult> {
  const result = await getTicketsCore(orgId, args)
  return result.ok ? textResult(result.data) : errorResult(result.error)
}

// ── create_ticket ────────────────────────────────────────────────────────

const createTicketDef: McpToolDefinition = {
  name: 'create_ticket',
  description: 'Open a new support ticket on behalf of a user. Runs the same AI triage/answer pipeline as every other channel (Discord, Slack, email) — the ticket may get auto-answered if confidence is high, otherwise it queues for human review. Use this when search_kb and generate_answer don\'t resolve the question and a human needs to see it.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: "The user's question or issue, verbatim" },
      authorName: { type: 'string', description: 'Name/identifier of the end user this ticket is on behalf of (optional)' },
      idempotencyKey: {
        type: 'string',
        description: 'Optional caller-supplied key (e.g. a UUID). Retrying the same call with the same key returns the original ticket instead of opening a duplicate — use this if your client retries on timeout/network error.',
      },
    },
    required: ['content'],
  },
  _meta: { requiredScope: TOOL_SCOPES.create_ticket },
}

async function createTicketTool(orgId: number, args: Record<string, unknown>): Promise<McpToolResult> {
  // idPrefix must stay 'mcp' — an existing client's stored idempotencyKey
  // derives its messageId from this prefix, and changing it here would
  // silently break their retry-dedup (see CreateTicketOpts JSDoc in core.ts).
  const result = await createTicketCore(orgId, args, { idPrefix: 'mcp', defaultAuthorName: 'MCP agent' })
  return result.ok ? textResult(result.data) : errorResult(result.error)
}

// ── generate_answer ──────────────────────────────────────────────────────

const generateAnswerDef: McpToolDefinition = {
  name: 'generate_answer',
  description: "Generate a grounded answer to a question using the organization's knowledge base, without opening a ticket. Returns the answer plus a confidence score. Counts against the org's monthly deflection limit — if the limit is reached, returns an error instead of generating for free.",
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to answer' },
    },
    required: ['question'],
  },
  _meta: { requiredScope: TOOL_SCOPES.generate_answer },
}

async function generateAnswer(orgId: number, args: Record<string, unknown>, keyId?: number | null): Promise<McpToolResult> {
  const result = await generateAnswerCore(orgId, args, keyId)
  return result.ok ? textResult(result.data) : errorResult(result.error)
}

// ── Registry ─────────────────────────────────────────────────────────────

export const MCP_TOOLS: McpToolDefinition[] = [searchKbDef, getFaqDef, getTicketsDef, createTicketDef, generateAnswerDef]

export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  orgId: number,
  keyId?: number | null
): Promise<McpToolResult> {
  try {
    switch (name) {
      case 'search_kb': return await searchKb(orgId, args)
      case 'get_faq': return await getFaq(orgId)
      case 'get_tickets': return await getTicketsTool(orgId, args)
      case 'create_ticket': return await createTicketTool(orgId, args)
      case 'generate_answer': return await generateAnswer(orgId, args, keyId)
      default: return errorResult(`Unknown tool: ${name}`)
    }
  } catch (err) {
    logger.error('MCP tool call threw', { module: MOD, tool: name, orgId, keyId, error: err })
    return errorResult('Internal error running tool')
  }
}
