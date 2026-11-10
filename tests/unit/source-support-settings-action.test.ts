import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The source-support settings actions: who may read and change them, how the
 * form is read (checkboxes, a percentage, an optional daily limit), and that
 * out-of-range values are refused rather than clamped. requireOrgAccess and the
 * query layer are mocked; the real SupportSettingsError is kept so the
 * storage's own refusals come through as the message shown.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getSupportSettings: vi.fn(),
  updateSupportSettings: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/logger', () => ({ logger: h.logger }))
vi.mock('@/lib/db/queries/kb-support', async () => {
  class SupportSettingsError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'SupportSettingsError'
    }
  }
  return {
    getSupportSettings: h.getSupportSettings,
    updateSupportSettings: h.updateSupportSettings,
    MAX_DAILY_LIMIT: 100_000,
    SupportSettingsError,
  }
})

import { getSourceSupportSettingsAction, saveSourceSupportSettingsAction } from '@/lib/actions/source-support'
import { SupportSettingsError } from '@/lib/db/queries/kb-support'

const OFF = {
  widgetEnabled: false,
  ticketEnabled: false,
  discordEnabled: false,
  agentApiEnabled: false,
  samplingRate: null,
  dailyLimit: null,
  excerptStorageEnabled: false,
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9, userId: 4, role: 'admin' })
  h.getSupportSettings.mockResolvedValue({ ...OFF })
  h.updateSupportSettings.mockImplementation(async (_org: number, patch: object) => ({ ...OFF, ...patch }))
})

describe('authorization', () => {
  it('reading asks for owner or admin, and nothing else', async () => {
    await getSourceSupportSettingsAction()
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('saving asks for owner or admin, and nothing else', async () => {
    await saveSourceSupportSettingsAction(null, form({}))
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('a member is refused before anything is read', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await getSourceSupportSettingsAction()).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.getSupportSettings).not.toHaveBeenCalled()
  })

  it('a member is refused before anything is written', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await saveSourceSupportSettingsAction(null, form({ widgetEnabled: 'on' }))).toEqual({
      error: 'You do not have permission to do that.',
    })
    expect(h.updateSupportSettings).not.toHaveBeenCalled()
  })

  it('reads and writes the workspace from the verified membership, with the user recorded', async () => {
    await getSourceSupportSettingsAction()
    expect(h.getSupportSettings).toHaveBeenCalledWith(9)
    await saveSourceSupportSettingsAction(null, form({}))
    expect(h.updateSupportSettings.mock.calls[0][0]).toBe(9)
    expect(h.updateSupportSettings.mock.calls[0][2]).toBe(4)
  })
})

describe('reading the form', () => {
  it('an empty form turns everything off and unset', async () => {
    const result = await saveSourceSupportSettingsAction(null, form({}))
    expect(h.updateSupportSettings).toHaveBeenCalledWith(9, OFF, 4)
    expect(result).toEqual({ settings: OFF })
  })

  it('each channel switch maps to its own setting', async () => {
    await saveSourceSupportSettingsAction(null, form({ discordEnabled: 'on' }))
    expect(h.updateSupportSettings.mock.calls[0][1]).toMatchObject({
      widgetEnabled: false,
      ticketEnabled: false,
      discordEnabled: true,
      agentApiEnabled: false,
      excerptStorageEnabled: false,
    })
  })

  it('excerpt storage is its own opt-in, independent of the channel switches', async () => {
    await saveSourceSupportSettingsAction(null, form({ excerptStorageEnabled: 'on' }))
    expect(h.updateSupportSettings.mock.calls[0][1]).toMatchObject({ widgetEnabled: false, excerptStorageEnabled: true })
  })

  it('the share is a percentage, stored as a rate', async () => {
    await saveSourceSupportSettingsAction(null, form({ samplingPercent: '25', dailyLimit: '200' }))
    expect(h.updateSupportSettings.mock.calls[0][1]).toMatchObject({ samplingRate: 0.25, dailyLimit: 200 })
  })

  it('keeps two decimals of a percentage without float noise', async () => {
    await saveSourceSupportSettingsAction(null, form({ samplingPercent: '33.3' }))
    expect(h.updateSupportSettings.mock.calls[0][1].samplingRate).toBe(0.333)
  })

  it('empty boxes mean unset, which checks nothing', async () => {
    await saveSourceSupportSettingsAction(null, form({ samplingPercent: '  ', dailyLimit: '' }))
    expect(h.updateSupportSettings.mock.calls[0][1]).toMatchObject({ samplingRate: null, dailyLimit: null })
  })

  it.each([
    ['samplingPercent', '101'],
    ['samplingPercent', '-1'],
    ['samplingPercent', 'lots'],
    ['dailyLimit', '-5'],
    ['dailyLimit', '2.5'],
    ['dailyLimit', '100001'],
    ['dailyLimit', 'many'],
  ])('refuses %s = %s without writing', async (field, value) => {
    const result = await saveSourceSupportSettingsAction(null, form({ [field]: value }))
    expect(result.error).toBeTruthy()
    expect(h.updateSupportSettings).not.toHaveBeenCalled()
  })

  it('accepts the edges: 0% and 100%, a limit of 0 and the maximum', async () => {
    for (const [p, d] of [['0', '0'], ['100', '100000']]) {
      h.updateSupportSettings.mockClear()
      const result = await saveSourceSupportSettingsAction(null, form({ samplingPercent: p, dailyLimit: d }))
      expect(result.error).toBeUndefined()
      expect(h.updateSupportSettings).toHaveBeenCalledTimes(1)
    }
  })
})

describe('storage errors', () => {
  it("passes the storage's own refusal through as the message", async () => {
    h.updateSupportSettings.mockRejectedValue(new SupportSettingsError('The sampling rate must be between 0 and 1'))
    expect(await saveSourceSupportSettingsAction(null, form({}))).toEqual({ error: 'The sampling rate must be between 0 and 1' })
  })

  it('anything else is a generic message, logged without leaking it to the form', async () => {
    h.updateSupportSettings.mockRejectedValue(new Error('connection refused at 10.0.0.5'))
    const result = await saveSourceSupportSettingsAction(null, form({}))
    expect(result).toEqual({ error: 'The settings could not be saved. Try again.' })
    expect(h.logger.error).toHaveBeenCalledTimes(1)
  })
})
