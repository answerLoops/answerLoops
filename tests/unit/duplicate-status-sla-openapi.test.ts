import { describe, it, expect, vi, beforeEach } from 'vitest'

// A ticket marked "duplicate" is terminal: it must never be flagged as an SLA
// resolve breach, and the public Agent API must advertise it as a valid
// status filter so MCP/HTTP clients can list and filter duplicates.

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: () => ({ execute }) }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { getSLAStatus, checkSlaBreaches } from '@/lib/sla/engine'
import { buildAgentOpenApiSpec } from '@/lib/agent/openapi-spec'
import { TICKET_STATUSES } from '@/lib/agent/core'

const PAST = new Date(Date.now() - 3_600_000).toISOString()

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    sla_response_deadline: null,
    sla_resolve_deadline: PAST,
    sla_response_met: null,
    sla_resolve_met: null,
    status: 'open',
    ...overrides,
  } as Parameters<typeof getSLAStatus>[0]
}

describe('getSLAStatus with duplicate tickets', () => {
  it('open ticket past its resolve deadline is breached (control)', () => {
    expect(getSLAStatus(ticket({ status: 'open' })).resolveBreached).toBe(true)
  })

  it('duplicate ticket past its resolve deadline is not breached', () => {
    const r = getSLAStatus(ticket({ status: 'duplicate' }))
    expect(r.resolveBreached).toBe(false)
    expect(r.anyBreached).toBe(false)
  })

  it.each(['resolved', 'closed'])('%s behaves the same as duplicate', (status) => {
    expect(getSLAStatus(ticket({ status })).resolveBreached).toBe(false)
  })
})

describe('checkSlaBreaches', () => {
  beforeEach(() => {
    execute.mockReset()
    execute.mockResolvedValue([])
  })

  it('excludes duplicate tickets from the resolve-breach UPDATE', async () => {
    await checkSlaBreaches(42)
    const dialect = new PgDialect()
    const statements = execute.mock.calls.map((c) => dialect.sqlToQuery(c[0]).sql)
    const resolveUpdate = statements.find((s) => s.includes('sla_resolve_met = 0'))
    expect(resolveUpdate).toBeDefined()
    expect(resolveUpdate).toContain(`NOT IN ('resolved', 'closed', 'duplicate')`)
  })
})

describe('Agent API OpenAPI spec', () => {
  it('lists duplicate in the tickets status filter enum, matching TICKET_STATUSES', () => {
    const spec = buildAgentOpenApiSpec() as unknown as {
      paths: Record<string, Record<string, { parameters?: { name: string; schema: { enum?: string[] } }[] }>>
    }
    const statusEnums: string[][] = []
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        for (const p of op.parameters ?? []) {
          if (p.name === 'status' && p.schema.enum) statusEnums.push(p.schema.enum)
        }
      }
    }
    expect(statusEnums.length).toBeGreaterThan(0)
    for (const e of statusEnums) {
      expect(e).toContain('duplicate')
      expect([...e].sort()).toEqual([...TICKET_STATUSES].sort())
    }
  })
})
