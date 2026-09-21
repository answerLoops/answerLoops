import { describe, it, expect } from 'vitest'
import { getSLAStatus } from '@/lib/sla/engine'

const PAST = new Date(Date.now() - 3_600_000).toISOString()   // 1h ago
const FUTURE = new Date(Date.now() + 3_600_000).toISOString() // 1h from now

function ticket(overrides: Partial<Parameters<typeof getSLAStatus>[0]> = {}) {
  return {
    sla_response_deadline: null,
    sla_resolve_deadline: null,
    sla_response_met: null,
    sla_resolve_met: null,
    status: 'open',
    ...overrides,
  } as Parameters<typeof getSLAStatus>[0]
}

describe('getSLAStatus', () => {
  describe('responseBreached', () => {
    it('met===0 → breached regardless of deadline', () => {
      const r = getSLAStatus(ticket({ sla_response_met: 0 }))
      expect(r.responseBreached).toBe(true)
      expect(r.anyBreached).toBe(true)
    })

    it('met===1 → not breached', () => {
      const r = getSLAStatus(ticket({ sla_response_met: 1, sla_response_deadline: PAST }))
      expect(r.responseBreached).toBe(false)
    })

    it('met===null + past deadline + open → breached', () => {
      const r = getSLAStatus(ticket({ sla_response_deadline: PAST, status: 'open' }))
      expect(r.responseBreached).toBe(true)
    })

    it('met===null + past deadline + non-open → not breached', () => {
      const r = getSLAStatus(ticket({ sla_response_deadline: PAST, status: 'in_progress' }))
      expect(r.responseBreached).toBe(false)
    })

    it('met===null + future deadline → not breached', () => {
      const r = getSLAStatus(ticket({ sla_response_deadline: FUTURE, status: 'open' }))
      expect(r.responseBreached).toBe(false)
    })

    it('no deadline → not breached', () => {
      const r = getSLAStatus(ticket({ sla_response_deadline: null }))
      expect(r.responseBreached).toBe(false)
    })
  })

  describe('resolveBreached', () => {
    it('met===0 → breached', () => {
      const r = getSLAStatus(ticket({ sla_resolve_met: 0 }))
      expect(r.resolveBreached).toBe(true)
    })

    it('met===null + past deadline + open → breached', () => {
      const r = getSLAStatus(ticket({ sla_resolve_deadline: PAST, status: 'open' }))
      expect(r.resolveBreached).toBe(true)
    })

    it('met===null + past deadline + resolved → not breached', () => {
      const r = getSLAStatus(ticket({ sla_resolve_deadline: PAST, status: 'resolved' }))
      expect(r.resolveBreached).toBe(false)
    })

    it('met===null + past deadline + closed → not breached', () => {
      const r = getSLAStatus(ticket({ sla_resolve_deadline: PAST, status: 'closed' }))
      expect(r.resolveBreached).toBe(false)
    })

    it('met===null + past deadline + duplicate → not breached', () => {
      const r = getSLAStatus(ticket({ sla_resolve_deadline: PAST, status: 'duplicate' }))
      expect(r.resolveBreached).toBe(false)
    })

    it('future deadline → not breached', () => {
      const r = getSLAStatus(ticket({ sla_resolve_deadline: FUTURE, status: 'open' }))
      expect(r.resolveBreached).toBe(false)
    })
  })

  describe('anyBreached', () => {
    it('neither breached → false', () => {
      expect(getSLAStatus(ticket()).anyBreached).toBe(false)
    })

    it('response only breached → true', () => {
      const r = getSLAStatus(ticket({ sla_response_met: 0 }))
      expect(r.anyBreached).toBe(true)
    })

    it('resolve only breached → true', () => {
      const r = getSLAStatus(ticket({ sla_resolve_met: 0 }))
      expect(r.anyBreached).toBe(true)
    })
  })

  describe('remainingMs', () => {
    it('no deadline → null', () => {
      const r = getSLAStatus(ticket())
      expect(r.responseRemainingMs).toBeNull()
      expect(r.resolveRemainingMs).toBeNull()
    })

    it('future deadline → positive ms', () => {
      const r = getSLAStatus(ticket({ sla_response_deadline: FUTURE, sla_resolve_deadline: FUTURE }))
      expect(r.responseRemainingMs).toBeGreaterThan(0)
      expect(r.resolveRemainingMs).toBeGreaterThan(0)
    })

    it('past deadline → negative ms', () => {
      const r = getSLAStatus(ticket({ sla_response_deadline: PAST, sla_resolve_deadline: PAST }))
      expect(r.responseRemainingMs).toBeLessThan(0)
      expect(r.resolveRemainingMs).toBeLessThan(0)
    })
  })
})
