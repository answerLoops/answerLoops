import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Covers the switch from an unconditional 15s poll to a Postgres
// LISTEN/NOTIFY-driven KB sync sweep (lib/db/migrate.ts + bot/index.ts):
// a kb_sync_jobs row transitioning into 'queued' now fires
// pg_notify('kb_sync_job_queued', id) via two triggers, which the bot's
// generalized watchNotifications() dispatches to startKbSyncSweep().trigger(),
// with a coarse 5-minute interval left only as a safety net. The previous
// 15-second unconditional interval kept a Neon-style serverless Postgres
// compute from ever autosuspending, running up billing for no work being
// done — see the removed KB_SYNC_SWEEP_INTERVAL_MS and its replacement,
// KB_SYNC_SAFETY_SWEEP_INTERVAL_MS, below.
//
// Like watch-config-changes-resilience.test.ts and kb-sync-jobs-queue.test.ts,
// bot/index.ts is not exported for import: it calls main() unconditionally at
// module load (bot/index.ts — `main().catch(...)`), which would log in to
// Discord and hit the database as a side effect of merely importing the file.
// So this suite verifies the migration SQL and the sweep/wiring logic
// structurally against the actual source text, the same approach already
// established in this repo for this exact file.

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

function extractFunction(src: string, signature: string): string {
  const idx = src.indexOf(signature)
  expect(idx, `Could not find "${signature}" in source`).toBeGreaterThanOrEqual(0)
  // The body-opening brace is the LAST '{' on the signature's own line, not
  // the first '{' after idx — a return-type annotation like
  // `(): { trigger: () => void; stop: () => void } {` contains braces of its
  // own before the real body starts.
  const lineEnd = src.indexOf('\n', idx)
  const braceStart = src.lastIndexOf('{', lineEnd === -1 ? src.length : lineEnd)
  let depth = 0
  let i = braceStart
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return src.slice(idx, i)
}

describe('lib/db/migrate.ts — kb_sync_job_queued NOTIFY trigger', () => {
  const src = read('lib/db/migrate.ts')

  it('defines notify_kb_sync_job_queued(), which pg_notify()s the queued job id', () => {
    const fnIdx = src.indexOf('CREATE OR REPLACE FUNCTION notify_kb_sync_job_queued')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnEnd = src.indexOf('$$;', fnIdx)
    const fnBody = src.slice(fnIdx, fnEnd)
    expect(fnBody).toContain("PERFORM pg_notify('kb_sync_job_queued', NEW.id::text)")
  })

  it('only one CREATE FUNCTION for notify_kb_sync_job_queued exists (no duplicate/divergent definition)', () => {
    const fnDefCount = (src.match(/CREATE OR REPLACE FUNCTION notify_kb_sync_job_queued/g) ?? []).length
    expect(fnDefCount).toBe(1)
  })

  it('creates trg_kb_sync_job_queued_insert AFTER INSERT, guarded to only fire when the new row is queued', () => {
    const idx = src.indexOf('CREATE TRIGGER trg_kb_sync_job_queued_insert')
    expect(idx).toBeGreaterThan(-1)
    const stmt = src.slice(idx, src.indexOf(';', idx))
    expect(stmt).toContain('ON kb_sync_jobs')
    expect(stmt).toContain('AFTER INSERT')
    expect(stmt).not.toMatch(/AFTER INSERT OR UPDATE/)
    // Regression guard: dropping this WHEN clause would fire the trigger (and
    // a NOTIFY) on every insert regardless of status, not only queued ones.
    expect(stmt).toContain("WHEN (NEW.status = 'queued')")
    expect(stmt).toContain('EXECUTE FUNCTION notify_kb_sync_job_queued()')
  })

  it('creates trg_kb_sync_job_queued_update AFTER UPDATE, guarded to only fire on a transition INTO queued', () => {
    const idx = src.indexOf('CREATE TRIGGER trg_kb_sync_job_queued_update')
    expect(idx).toBeGreaterThan(-1)
    const stmt = src.slice(idx, src.indexOf(';', idx))
    expect(stmt).toContain('ON kb_sync_jobs')
    expect(stmt).toContain('AFTER UPDATE')
    // Regression guard: this is the exact bug this test exists to catch — a
    // future edit that silently drops the OLD.status check would notify (and
    // re-trigger a sweep) on every update to an already-queued row, not only
    // on the transition into 'queued' (e.g. a reclaim-stuck requeue or a
    // fresh enqueue).
    expect(stmt).toContain("WHEN (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM 'queued')")
    expect(stmt).toContain('EXECUTE FUNCTION notify_kb_sync_job_queued()')
  })

  it('both triggers are idempotent — DROP TRIGGER IF EXISTS precedes each CREATE TRIGGER', () => {
    for (const name of ['trg_kb_sync_job_queued_insert', 'trg_kb_sync_job_queued_update']) {
      const dropIdx = src.indexOf(`DROP TRIGGER IF EXISTS ${name} ON kb_sync_jobs`)
      const createIdx = src.indexOf(`CREATE TRIGGER ${name}`)
      expect(dropIdx, `missing idempotent DROP for ${name}`).toBeGreaterThan(-1)
      expect(createIdx).toBeGreaterThan(dropIdx)
    }
  })
})

describe('bot/index.ts — safety-net sweep interval regression guard', () => {
  const src = read('bot/index.ts')

  it('the old unconditional 15-second poll constant no longer exists', () => {
    expect(src).not.toContain('KB_SYNC_SWEEP_INTERVAL_MS')
  })

  it('KB_SYNC_SAFETY_SWEEP_INTERVAL_MS is at least 60 seconds — a short interval here would defeat serverless Postgres autosuspend the same way the removed constant did', () => {
    const match = src.match(/const KB_SYNC_SAFETY_SWEEP_INTERVAL_MS\s*=\s*([^\n]+)/)
    expect(match, 'KB_SYNC_SAFETY_SWEEP_INTERVAL_MS not found').not.toBeNull()
    // Evaluate the numeric expression (e.g. "5 * 60 * 1000") rather than
    // string-matching a specific literal, so the guard survives an
    // equivalent rewrite (e.g. changing 5*60*1000 to 300_000).
    const raw = match![1].trim().replace(/,?\s*$/, '')
    // eslint-disable-next-line no-eval
    const value = Function(`"use strict"; return (${raw});`)()
    expect(typeof value).toBe('number')
    expect(value).toBeGreaterThanOrEqual(60_000)
  })

  it('the sweep is wired into main() via startKbSyncSweep(), not a bare setInterval at module scope', () => {
    expect(src).toContain('const kbSyncSweep = startKbSyncSweep()')
  })
})

describe('bot/index.ts — startKbSyncSweep() running/pending collapse guard', () => {
  const src = read('bot/index.ts')
  const fn = extractFunction(src, 'function startKbSyncSweep()')

  it('returns a { trigger, stop } object instead of void', () => {
    const sigIdx = src.indexOf('function startKbSyncSweep()')
    const sigLineEnd = src.indexOf('\n', sigIdx)
    const sigLine = src.slice(sigIdx, sigLineEnd)
    expect(sigLine).toMatch(/:\s*\{\s*trigger:\s*\(\)\s*=>\s*void;\s*stop:\s*\(\)\s*=>\s*void\s*\}/)
    expect(fn).toMatch(/return\s*\{\s*\n?\s*trigger:\s*\(\)\s*=>/)
    expect(fn).toMatch(/stop:\s*\(\)\s*=>\s*clearInterval\(timer\)/)
  })

  it('short-circuits with a pending flag before setting running, when a sweep is already in flight', () => {
    // Guard must appear before `running = true` is assigned, and must not
    // itself flip `running` — otherwise an overlapping call could still race
    // the in-flight sweep instead of deferring to it.
    const guardIdx = fn.indexOf('if (running) { pending = true; return }')
    const runningTrueIdx = fn.indexOf('running = true')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(runningTrueIdx).toBeGreaterThan(guardIdx)
  })

  it('resets running and re-invokes the sweep from a finally block when a call arrived while busy', () => {
    const finallyIdx = fn.indexOf('finally {')
    expect(finallyIdx).toBeGreaterThan(-1)
    const finallyEnd = fn.indexOf('\n  }', finallyIdx)
    const finallyBody = fn.slice(finallyIdx, finallyEnd === -1 ? undefined : finallyEnd)
    expect(finallyBody).toContain('running = false')
    expect(finallyBody).toMatch(/if\s*\(pending\)\s*\{/)
    expect(finallyBody).toContain('pending = false')
    // Re-invokes the same sweep function, not the interval or trigger — a
    // burst of NOTIFYs during a sweep collapses into exactly one extra pass.
    expect(finallyBody).toMatch(/sweep\(\)\.catch\(/)
    // The re-invocation must happen after pending is cleared, or a second
    // burst arriving during that extra pass would be dropped instead of
    // requesting yet another pass.
    const pendingFalseIdx = finallyBody.indexOf('pending = false')
    const reinvokeIdx = finallyBody.indexOf('sweep().catch(')
    expect(reinvokeIdx).toBeGreaterThan(pendingFalseIdx)
  })

  it('both the interval tick and the external trigger() call the same sweep function, so they collapse through the same guard', () => {
    const intervalIdx = fn.indexOf('setInterval(() => { sweep().catch(() => {}) }, KB_SYNC_SAFETY_SWEEP_INTERVAL_MS)')
    const triggerIdx = fn.indexOf('trigger: () => { sweep().catch(() => {}) }')
    expect(intervalIdx).toBeGreaterThan(-1)
    expect(triggerIdx).toBeGreaterThan(-1)
  })
})

describe('bot/index.ts — main() wires both LISTEN channels through watchNotifications', () => {
  const src = read('bot/index.ts')

  it('watchNotifications is called with an object keyed by config_changed and kb_sync_job_queued', () => {
    const callIdx = src.indexOf('watchNotifications({')
    expect(callIdx).toBeGreaterThan(-1)
    const closeIdx = src.indexOf('\n  })', callIdx)
    const call = src.slice(callIdx, closeIdx === -1 ? callIdx + 800 : closeIdx)
    expect(call).toMatch(/config_changed:\s*async/)
    expect(call).toContain('kb_sync_job_queued:')
  })

  it('the kb_sync_job_queued handler calls kbSyncSweep.trigger()', () => {
    const callIdx = src.indexOf('watchNotifications({')
    const closeIdx = src.indexOf('\n  })', callIdx)
    const call = src.slice(callIdx, closeIdx === -1 ? callIdx + 800 : closeIdx)
    const handlerIdx = call.indexOf('kb_sync_job_queued:')
    const handlerLine = call.slice(handlerIdx, call.indexOf('\n', handlerIdx))
    expect(handlerLine).toContain('kbSyncSweep.trigger()')
  })

  it('kbSyncSweep is created before watchNotifications wires the kb_sync_job_queued handler to it', () => {
    const createIdx = src.indexOf('const kbSyncSweep = startKbSyncSweep()')
    const wireIdx = src.indexOf('watchNotifications({')
    expect(createIdx).toBeGreaterThan(-1)
    expect(wireIdx).toBeGreaterThan(createIdx)
  })

  it('graceful shutdown stops the sweep interval and closes the LISTEN connection', () => {
    const sigHandlerIdx = src.indexOf("for (const sig of ['SIGINT', 'SIGTERM'])")
    expect(sigHandlerIdx).toBeGreaterThanOrEqual(0)
    const handlerBody = src.slice(sigHandlerIdx, sigHandlerIdx + 400)
    expect(handlerBody).toContain('kbSyncSweep.stop()')
    expect(handlerBody).toMatch(/await stopListening\(\)/)
  })
})

describe('bot/index.ts — watchNotifications() generalizes the single-channel LISTEN watcher', () => {
  const src = read('bot/index.ts')
  const fn = extractFunction(src, 'function watchNotifications(')

  it('takes a handlers map and LISTENs on every key, not a single hardcoded channel', () => {
    expect(fn).toContain('const channels = Object.keys(handlers)')
    expect(fn).toContain("map((c) => `LISTEN ${c}`).join('; ')")
  })

  it('dispatches an incoming NOTIFY to the handler matching its channel', () => {
    const onnotifyIdx = fn.indexOf('onnotify:')
    const body = fn.slice(onnotifyIdx, onnotifyIdx + 300)
    expect(body).toContain('const handler = handlers[channel]')
    expect(body).toContain('if (!handler) return')
    expect(body).toContain('handler(payload)')
  })

  it('no longer hardcodes the old single-channel name in the LISTEN/onnotify plumbing', () => {
    // The old watchConfigChanges() implementation LISTENed on a single
    // literal channel and filtered onnotify to it directly; the generalized
    // version must route through the handlers map instead.
    expect(fn).not.toMatch(/LISTEN config_changed/)
    expect(fn).not.toMatch(/if \(channel !== 'config_changed'\) return/)
  })
})
