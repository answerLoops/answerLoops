import { API_SCOPES } from '@/lib/agent/scopes'

/**
 * The single source of truth for the Agent API's OpenAPI description.
 *
 * Every path below actually exists and works. It is served verbatim at two
 * URLs so an agent finds it wherever it looks:
 *   - /openapi.json              (the conventional root location scanners probe)
 *   - /api/agent/openapi.json    (kept — linked from .well-known/ai-plugin.json
 *                                 and consumed by scripts/generate-api-reference)
 *
 * MCP-native clients (Claude Code, Cursor) should use the MCP server at
 * POST /api/mcp instead; this REST surface exists for tooling that speaks
 * HTTP + OpenAPI, not JSON-RPC.
 *
 * Least-privilege: each operation declares the one scope it needs in its
 * `security` block, drawn from lib/agent/scopes.ts. This requires OpenAPI
 * 3.1.0 — 3.0.x only allows a non-empty scope array against an oauth2 /
 * openIdConnect scheme, and strict validators reject it against a plain
 * bearer scheme. The same scope names are also published as machine-readable
 * RFC 9728 protected-resource metadata at /.well-known/oauth-protected-resource
 * and carried on each MCP tool's `_meta.requiredScope`.
 *
 * `origin` is the absolute base URL the spec advertises in `servers` — passed
 * as the request origin by the route handlers so a self-hosted instance
 * describes itself correctly; the checked-in reference copy
 * (content/docs/reference/api/openapi.json) uses the default.
 */
export function buildAgentOpenApiSpec(origin = 'https://answerloops.com') {
  const scoped = (scope: keyof typeof API_SCOPES) => [{ bearerAuth: [scope] }]

  return {
    openapi: '3.1.0',
    info: {
      title: 'answerLoops Agent API',
      description:
        'REST API for AI agents and non-MCP frameworks (LangChain, AutoGen, custom bots) to search a knowledge base, read the latest FAQ, list/create tickets, and generate grounded answers — the same pipeline every other answerLoops channel uses. MCP-native clients (Claude Code, Cursor) should use the MCP server at POST /api/mcp instead; this REST surface exists for tooling that speaks HTTP + OpenAPI, not JSON-RPC.',
      version: '1.1.0',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    // Machine-readable scope catalogue. Mirrored in the RFC 9728 metadata at
    // /.well-known/oauth-protected-resource (scopes_supported).
    'x-api-scopes': Object.fromEntries(
      Object.entries(API_SCOPES).map(([name, description]) => [name, { description }])
    ),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Org-scoped API key generated in Settings → API Keys (al_live_ prefix). Shared with the MCP server — the same key authenticates both surfaces. A key carries a set of least-privilege scopes; each operation lists the scope it requires. A key missing a required scope gets 403 with a `WWW-Authenticate: Bearer error="insufficient_scope"` header. Scope catalogue: see the `x-api-scopes` object and /.well-known/oauth-protected-resource.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
            },
          },
          required: ['error'],
        },
        Ticket: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            content: { type: 'string' },
            category: { type: 'string', nullable: true },
            priority: { type: 'string' },
            status: { type: 'string' },
            ai_summary: { type: 'string', nullable: true },
            created_at: { type: 'string' },
          },
        },
      },
      responses: {
        InsufficientScope: {
          description: 'Valid key, but it lacks the scope this operation requires',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    paths: {
      '/api/agent/kb/search': {
        get: {
          operationId: 'searchKb',
          summary: "Semantically search the organization's knowledge base",
          security: scoped('kb:read'),
          parameters: [
            { name: 'query', in: 'query', required: true, schema: { type: 'string', maxLength: 2000 } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } },
          ],
          responses: {
            '200': {
              description: 'Matching KB articles, most relevant first',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      results: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            question: { type: 'string' },
                            answer: { type: 'string' },
                            score: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'Missing or invalid query', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '401': { description: 'Missing/invalid/revoked API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { $ref: '#/components/responses/InsufficientScope' },
            '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/agent/faq': {
        get: {
          operationId: 'getFaq',
          summary: "Get the organization's most recently generated FAQ digest",
          security: scoped('faq:read'),
          responses: {
            '200': {
              description: 'Latest FAQ digest, or a message if none has been generated yet',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '401': { description: 'Missing/invalid/revoked API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { $ref: '#/components/responses/InsufficientScope' },
          },
        },
      },
      '/api/agent/tickets': {
        get: {
          operationId: 'getTickets',
          summary: 'List support tickets for the organization',
          security: scoped('tickets:read'),
          parameters: [
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] } },
            { name: 'priority', in: 'query', required: false, schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
            { name: 'category', in: 'query', required: false, schema: { type: 'string', enum: ['bug', 'feature_request', 'documentation', 'how_to', 'general_question'] } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } },
          ],
          responses: {
            '200': {
              description: 'Most recent tickets first',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { tickets: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } } } },
                },
              },
            },
            '400': { description: 'Invalid filter value', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '401': { description: 'Missing/invalid/revoked API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { $ref: '#/components/responses/InsufficientScope' },
          },
        },
        post: {
          operationId: 'createTicket',
          summary: 'Open a new support ticket on behalf of a user',
          security: scoped('tickets:write'),
          description:
            'Runs through the same AI triage/answer pipeline as every other channel (Discord, Slack, email) — the ticket may get auto-answered if confidence is high, otherwise it queues for human review.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    content: { type: 'string', maxLength: 4000, description: "The user's question or issue, verbatim" },
                    authorName: { type: 'string', description: 'Name/identifier of the end user this ticket is on behalf of (optional)' },
                    idempotencyKey: { type: 'string', maxLength: 200, description: 'Optional caller-supplied key — retrying with the same key returns the original ticket instead of opening a duplicate' },
                  },
                  required: ['content'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Ticket created (or the original ticket, if idempotencyKey matched a prior call)',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ticket_id: { type: 'integer' }, duplicate: { type: 'boolean' } } },
                },
              },
            },
            '400': { description: 'Missing/invalid content', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '401': { description: 'Missing/invalid/revoked API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { $ref: '#/components/responses/InsufficientScope' },
          },
        },
      },
      '/api/agent/answers': {
        post: {
          operationId: 'generateAnswer',
          summary: "Generate a grounded answer using the organization's knowledge base, without opening a ticket",
          security: scoped('answers:write'),
          description:
            "Counts against the org's monthly deflection limit — if the limit is reached, returns 429 instead of generating for free. Only high-confidence generations count toward that limit.",
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', properties: { question: { type: 'string', maxLength: 2000 } }, required: ['question'] },
              },
            },
          },
          responses: {
            '200': {
              description: 'Generated answer with confidence score',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      answer: { type: 'string' },
                      confidence: { type: 'integer' },
                      answered_fully: { type: 'boolean' },
                      high_confidence: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            '400': { description: 'Missing/invalid question', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '401': { description: 'Missing/invalid/revoked API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { $ref: '#/components/responses/InsufficientScope' },
            '429': { description: 'Monthly deflection limit reached, or rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
    },
  }
}
