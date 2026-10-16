import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The bot process cannot be imported in vitest (it logs in to chat platforms on
// load), so these assert on the structure of bot/index.ts, the same approach
// as the other bot tests.

const bot = fs.readFileSync(path.join(process.cwd(), 'bot/index.ts'), 'utf-8')
const fnStart = bot.indexOf('function startKbRetentionSweep')
const fnEnd = bot.indexOf('\nfunction ', fnStart + 10)
const fn = bot.slice(fnStart, fnEnd)

describe('bot knowledge-base retention sweep', () => {
  it('imports both cleanup functions from their query modules', () => {
    expect(bot).toMatch(/import \{[^}]*\bpurgeExpiredReviewText\b[^}]*\} from '(?:@|\.\.)\/lib\/db\/queries\/kb-review'/)
    expect(bot).toMatch(/import \{[^}]*\bpruneArticleUsage\b[^}]*\} from '(?:@|\.\.)\/lib\/db\/queries\/kb-usage'/)
  })

  it('runs once a day', () => {
    expect(bot).toMatch(/const KB_RETENTION_SWEEP_INTERVAL_MS = 24 \* 60 \* 60 \* 1000\b/)
    expect(fn).toMatch(/setInterval\([\s\S]*\}, KB_RETENTION_SWEEP_INTERVAL_MS\)/)
  })

  it('runs both cleanups in each pass', () => {
    expect(fn).toContain('await purgeExpiredReviewText()')
    expect(fn).toContain('await pruneArticleUsage()')
  })

  it('catches a failing pass inside the sweep and logs it, so the loop keeps going', () => {
    const tryAt = fn.indexOf('try {')
    const cleanupAt = fn.indexOf('await purgeExpiredReviewText()')
    const catchAt = fn.indexOf('} catch (err)')
    expect(tryAt).toBeGreaterThan(-1)
    expect(tryAt).toBeLessThan(cleanupAt)
    expect(cleanupAt).toBeLessThan(catchAt)
    expect(fn.slice(catchAt)).toMatch(/logger\.error\('kb retention sweep failed'/)
  })

  it('never lets a rejected pass escape as an unhandled rejection, at startup or on the interval', () => {
    expect(fn).toMatch(/\n\s*sweep\(\)\.catch\(\(\) => \{\}\)/)
    expect(fn).toMatch(/setInterval\(\(\) => \{ sweep\(\)\.catch\(\(\) => \{\}\) \}/)
  })

  it('is started exactly once, from startup', () => {
    expect(bot.match(/startKbRetentionSweep\(\)/g)).toHaveLength(2) // definition + one call
    const mainStart = bot.indexOf('async function main')
    expect(bot.indexOf('  startKbRetentionSweep()')).toBeGreaterThan(mainStart)
  })

  it('reclaims a stuck sync job only after five minutes without a heartbeat', () => {
    expect(bot).toMatch(/const KB_SYNC_STUCK_THRESHOLD_MS = 5 \* 60 \* 1000/)
  })
})
