import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The bot process cannot be imported in vitest (it logs in to chat platforms on
// load), so the sweep is cut out of bot/index.ts and executed here against a
// fake fetch, logger and timer. That checks what it does, not just what it says.

const bot = fs.readFileSync(path.join(process.cwd(), 'bot/index.ts'), 'utf-8')

function sliceSweep(): string {
  const start = bot.indexOf('const TRIAL_REMINDER_SWEEP_INTERVAL_MS')
  const fnStart = bot.indexOf('function startTrialReminderSweep')
  expect(start).toBeGreaterThan(-1)
  expect(fnStart).toBeGreaterThan(start)
  const end = bot.indexOf('\n}\n', fnStart)
  return bot.slice(start, end + 3)
}

// Strip the two TypeScript annotations in the slice so it runs as plain JS.
const js = sliceSweep().replace('startTrialReminderSweep(): void', 'startTrialReminderSweep()')
const intervalMs = Number(/TRIAL_REMINDER_SWEEP_INTERVAL_MS = (\d+(?: \* \d+)*)/.exec(js)![1].split('*').reduce((a, b) => a * Number(b), 1))

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
let fetchMock: ReturnType<typeof vi.fn>
let intervals: { fn: () => void; ms: number }[]
let timeoutSpy: ReturnType<typeof vi.spyOn>

function start(env: { BOT_SECRET?: string; BOT_TARGET_URL?: string }) {
  const saved = { s: process.env.BOT_SECRET, t: process.env.BOT_TARGET_URL }
  if (env.BOT_SECRET === undefined) delete process.env.BOT_SECRET
  else process.env.BOT_SECRET = env.BOT_SECRET
  if (env.BOT_TARGET_URL === undefined) delete process.env.BOT_TARGET_URL
  else process.env.BOT_TARGET_URL = env.BOT_TARGET_URL
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('logger', 'MOD', 'fetch', 'setInterval', `${js}\nstartTrialReminderSweep()`)(
      logger,
      'bot',
      fetchMock,
      (fn: () => void, ms: number) => intervals.push({ fn, ms }),
    )
  } finally {
    if (saved.s === undefined) delete process.env.BOT_SECRET
    else process.env.BOT_SECRET = saved.s
    if (saved.t === undefined) delete process.env.BOT_TARGET_URL
    else process.env.BOT_TARGET_URL = saved.t
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  intervals = []
  logger.warn.mockClear()
  logger.error.mockClear()
  timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
})
afterEach(() => timeoutSpy.mockRestore())

describe('bot trial-reminder sweep', () => {
  it('is started from main() alongside the other sweeps, after the chat clients are wired', () => {
    const calls = ['startOrgPurgeSweep()', 'startKbRetentionSweep()', 'startStuckTicketSweep()', 'startEmbeddingMigrationSweep()', 'startTrialReminderSweep()']
    const positions = calls.map((c) => bot.lastIndexOf(`\n  ${c}`))
    positions.forEach((p, i) => expect(p, `${calls[i]} is not called from main()`).toBeGreaterThan(-1))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(bot.match(/\n\s*startTrialReminderSweep\(\)/g)).toHaveLength(1)
  })

  it('runs hourly and registers exactly one repeating timer', () => {
    start({ BOT_SECRET: 'bot-secret-value' })
    expect(intervalMs).toBe(60 * 60 * 1000)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(intervalMs)
  })

  it('posts to the reminder route with the bot secret as a bearer token, and sweeps once at startup', async () => {
    start({ BOT_SECRET: 'bot-secret-value', BOT_TARGET_URL: 'https://app.example.test' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://app.example.test/api/billing/trial-reminders/run')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer bot-secret-value' })
  })

  it('falls back to localhost:3000 when no target url is configured', async () => {
    start({ BOT_SECRET: 'bot-secret-value' })
    await flush()
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/billing/trial-reminders/run')
  })

  it('does nothing at all without BOT_SECRET, since the route would only answer 401', async () => {
    start({})
    await flush()
    intervals[0].fn()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('puts a two-minute timeout on the request', async () => {
    start({ BOT_SECRET: 'bot-secret-value' })
    await flush()
    expect(timeoutSpy).toHaveBeenCalledWith(2 * 60 * 1000)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('never overlaps: a tick while the previous request is still running is skipped, then work resumes', async () => {
    let release!: () => void
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: true, status: 200 }) }))
    start({ BOT_SECRET: 'bot-secret-value' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    intervals[0].fn()
    intervals[0].fn()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()
    await flush()
    intervals[0].fn()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('logs a non-2xx answer and keeps going', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    start({ BOT_SECRET: 'bot-secret-value' })
    await flush()
    expect(logger.warn).toHaveBeenCalledWith('trial reminder sweep: request failed', expect.objectContaining({ status: 500 }))
    intervals[0].fn()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('swallows a network failure or timeout, logs it, and releases the guard so the next tick runs', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    start({ BOT_SECRET: 'bot-secret-value' })
    await flush()
    expect(logger.error).toHaveBeenCalledWith('trial reminder sweep failed', expect.objectContaining({ error: expect.any(Error) }))
    intervals[0].fn()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
