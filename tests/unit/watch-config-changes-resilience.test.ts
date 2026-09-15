import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Covers the reconnect/resilience rewrite of bot/index.ts's watchConfigChanges():
// production incident where the dedicated LISTEN connection went silently
// stale after ~30 minutes idle (Neon auto-suspend / a proxy dropping a
// long-idle TCP connection without a clean `close`), and every NOTIFY after
// that point was lost with nothing in the logs until someone manually
// restarted the bot process. The fix replaces postgres.js's `.listen()`
// sugar (which opens its own hidden connection and only reconnects on a
// clean `close` event) with a directly-managed connection: a heartbeat query
// that both prevents idle auto-suspend and detects a dead socket quickly,
// plus an epoch-guarded reconnect so a stray onclose from our own
// intentional `current?.end()` during a reconnect can't schedule a second,
// redundant reconnect on top of the one already in flight.
//
// `watchConfigChanges` was generalized to `watchNotifications` (still not
// exported) when the KB sync worker moved from a 15-second unconditional
// poll to a kb_sync_job_queued NOTIFY delivered on this same connection —
// see kb-sync-notify-driven-sweep.test.ts for coverage of that channel and
// the sweep it drives. This file's resilience assertions (heartbeat, epoch
// guard, reconnect) are unchanged in substance; only the function name and
// the LISTEN/onnotify call shapes moved from a single hardcoded channel to
// one built from `Object.keys(handlers)`.
//
// `watchNotifications` is not exported from bot/index.ts, and the module
// calls `main()` unconditionally at import time (bot/index.ts:602 —
// `main().catch(...)` with no `require.main === module` guard), which would
// log in to Discord, hit the database, and start the Slack poller as a side
// effect of merely importing the file. Mocking that entire surface (discord.js
// Client, half a dozen DB query modules, the Slack poller, billing/feature-flag
// lookups) just to reach a single inner closure is not a realistic or stable
// path to a behavioral test, and rewriting bot/index.ts to expose the closure
// is out of scope here (tests only, no source changes). So this suite verifies
// the resilience logic structurally against the actual source text — grepping
// for and pinpointing the literal control flow — rather than by invoking it.
// This is a real coverage gap: heartbeat firing, an actual reconnect executing,
// and the epoch guard suppressing a duplicate reconnect are all asserted here
// by reading the code, not by running it. None of it is exercised at runtime
// by this test file.

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

function extractFunction(src: string, signature: string): string {
  const idx = src.indexOf(signature)
  expect(idx, `Could not find "${signature}" in source`).toBeGreaterThanOrEqual(0)
  // Walk braces from the first `{` after the signature to find the matching close.
  const braceStart = src.indexOf('{', idx)
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

const src = read('bot/index.ts')
const fn = extractFunction(src, 'function watchNotifications')
// Every previous `sql.unsafe('LISTEN config_changed')` call site now reads
// `sql.unsafe(channels.map((c) => \`LISTEN ${c}\`).join('; '))` — channels is
// built from Object.keys(handlers), so no channel name is hardcoded at the
// call site any more. Tests below locate that call generically.
const LISTEN_CALL = "sql.unsafe(channels.map("

describe('watchNotifications — heartbeat constant', () => {
  it('heartbeat interval is 4 minutes', () => {
    expect(src).toMatch(/const LISTEN_HEARTBEAT_INTERVAL_MS\s*=\s*4\s*\*\s*60\s*\*\s*1000/)
  })

  it('the heartbeat query runs on the same connection object the LISTEN was issued on (sql), not a fresh one', () => {
    // The heartbeat closure and the LISTEN call must both reference the same
    // local `sql` binding created by `postgres(url, options)` in this connect().
    const sqlAssignIdx = fn.indexOf('const sql = postgres(url, options)')
    const listenIdx = fn.indexOf(LISTEN_CALL)
    const heartbeatIdx = fn.indexOf("sql.unsafe('SELECT 1')")
    expect(sqlAssignIdx).toBeGreaterThanOrEqual(0)
    expect(listenIdx).toBeGreaterThan(sqlAssignIdx)
    expect(heartbeatIdx).toBeGreaterThan(listenIdx)
  })
})

describe('watchNotifications — heartbeat is gated on LISTEN success', () => {
  it('the heartbeat setInterval is created only inside the LISTEN .then(), not unconditionally after connect', () => {
    const listenCallIdx = fn.indexOf(LISTEN_CALL)
    const thenIdx = fn.indexOf('.then(', listenCallIdx)
    const catchIdx = fn.indexOf('.catch(', thenIdx)
    const heartbeatCreateIdx = fn.indexOf('heartbeat = setInterval(')
    expect(thenIdx).toBeGreaterThan(listenCallIdx)
    expect(catchIdx).toBeGreaterThan(thenIdx)
    // setInterval assignment must be between .then( and .catch( — i.e. inside
    // the success callback, not in the outer connect() body or the catch.
    expect(heartbeatCreateIdx).toBeGreaterThan(thenIdx)
    expect(heartbeatCreateIdx).toBeLessThan(catchIdx)
  })

  it('the LISTEN .then() bails on a stale epoch before touching heartbeat — code review finding: a newer connect() can take over before this promise settles, and unconditionally setting heartbeat here would clobber the real one with an interval polling an already-superseded connection', () => {
    const listenCallIdx = fn.indexOf(LISTEN_CALL)
    const thenIdx = fn.indexOf('.then(', listenCallIdx)
    const heartbeatCreateIdx = fn.indexOf('heartbeat = setInterval(', thenIdx)
    const guardIdx = fn.indexOf('if (myEpoch !== epoch) return', thenIdx)
    expect(guardIdx).toBeGreaterThan(thenIdx)
    expect(guardIdx).toBeLessThan(heartbeatCreateIdx)
  })

  it('the LISTEN failure branch reconnects instead of silently giving up', () => {
    const catchIdx = fn.indexOf('.catch(', fn.indexOf(LISTEN_CALL))
    const catchBody = fn.slice(catchIdx, catchIdx + 300)
    expect(catchBody).toContain('scheduleReconnect(myEpoch')
    expect(catchBody).toContain("'initial LISTEN failed'")
  })

  it('a heartbeat query failure triggers a reconnect rather than being swallowed', () => {
    const heartbeatIdx = fn.indexOf("sql.unsafe('SELECT 1')")
    const heartbeatLine = fn.slice(heartbeatIdx, heartbeatIdx + 200)
    expect(heartbeatLine).toContain('.catch(')
    expect(heartbeatLine).toContain('scheduleReconnect(myEpoch')
    expect(heartbeatLine).toContain("'heartbeat failed'")
  })
})

describe('watchNotifications — epoch guard captures myEpoch, not the live epoch', () => {
  // This is the actual bug the epoch guard exists to prevent: if the onclose
  // or heartbeat-failure closures captured the live, mutable `epoch` variable
  // instead of the `myEpoch` constant frozen at connect()-time, a stray
  // callback from a connection we intentionally replaced would always match
  // the current epoch (since `epoch` would have already been bumped by the
  // new connect() call by the time it fires) and could still schedule a
  // second, redundant reconnect — defeating the guard entirely.

  it('connect() assigns a frozen myEpoch by incrementing the live epoch', () => {
    expect(fn).toMatch(/const myEpoch = \+\+epoch/)
  })

  it('onclose calls scheduleReconnect with myEpoch, not epoch', () => {
    const oncloseIdx = fn.indexOf('onclose:')
    expect(oncloseIdx).toBeGreaterThanOrEqual(0)
    const oncloseLine = fn.slice(oncloseIdx, fn.indexOf('\n', oncloseIdx))
    expect(oncloseLine).toContain('scheduleReconnect(myEpoch')
    expect(oncloseLine).not.toMatch(/scheduleReconnect\(epoch\b/)
  })

  it('the heartbeat failure callback calls scheduleReconnect with myEpoch, not epoch', () => {
    const heartbeatIdx = fn.indexOf("sql.unsafe('SELECT 1')")
    const heartbeatLine = fn.slice(heartbeatIdx, fn.indexOf('\n', heartbeatIdx))
    expect(heartbeatLine).toContain('scheduleReconnect(myEpoch')
    expect(heartbeatLine).not.toMatch(/scheduleReconnect\(epoch\b/)
  })

  it('the initial-LISTEN-failure callback calls scheduleReconnect with myEpoch, not epoch', () => {
    const catchIdx = fn.indexOf('.catch(', fn.indexOf(LISTEN_CALL))
    const catchBody = fn.slice(catchIdx, catchIdx + 300)
    expect(catchBody).toContain('scheduleReconnect(myEpoch')
    expect(catchBody).not.toMatch(/scheduleReconnect\(epoch\b/)
  })

  it('scheduleReconnect only acts when forEpoch matches the live epoch (guards against a stale connection\'s late callback)', () => {
    const idx = fn.indexOf('const scheduleReconnect')
    const guardLine = fn.slice(idx, fn.indexOf('\n', fn.indexOf('return', idx)))
    expect(guardLine).toMatch(/forEpoch\s*!==\s*epoch/)
  })
})

describe('watchNotifications — scheduleReconnect guards', () => {
  it('checks stopped, epoch match, and an in-flight reconnectTimer before scheduling', () => {
    const idx = fn.indexOf('const scheduleReconnect')
    const guardLine = fn.slice(idx, fn.indexOf('\n', fn.indexOf('return', idx)))
    expect(guardLine).toContain('stopped')
    expect(guardLine).toMatch(/forEpoch\s*!==\s*epoch/)
    expect(guardLine).toContain('reconnectTimer')
    // All three conditions must short-circuit the same early return.
    expect(guardLine).toMatch(/if\s*\(stopped \|\| forEpoch !== epoch \|\| reconnectTimer\) return/)
  })

  it('reconnect is delayed (not immediate) and clears reconnectTimer before calling connect() again', () => {
    const idx = fn.indexOf('const scheduleReconnect')
    const body = fn.slice(idx, idx + 400)
    expect(body).toMatch(/setTimeout\(\(\) => \{/)
    expect(body).toMatch(/reconnectTimer = null/)
    expect(body).toMatch(/connect\(\)/)
    expect(body).toMatch(/\},\s*2000\)/)
    // reconnectTimer must be nulled out before connect() runs, not after —
    // otherwise a reconnect triggered from inside the new connect() (e.g. an
    // immediate onclose) would be blocked by the still-set old timer handle.
    const nullIdx = body.indexOf('reconnectTimer = null')
    const connectIdx = body.indexOf('connect()')
    expect(nullIdx).toBeGreaterThan(0)
    expect(connectIdx).toBeGreaterThan(nullIdx)
  })
})

describe('watchNotifications — connect() tears down the previous connection cleanly', () => {
  it('clears any existing heartbeat before opening a new connection', () => {
    const connectIdx = fn.indexOf('const connect = ()')
    const body = fn.slice(connectIdx, connectIdx + 1200)
    const clearIdx = body.indexOf('clearInterval(heartbeat)')
    const newSqlIdx = body.indexOf('postgres(url, options)')
    expect(clearIdx).toBeGreaterThan(0)
    expect(newSqlIdx).toBeGreaterThan(clearIdx)
  })

  it('ends the previous connection (non-blocking) before opening a new one', () => {
    const connectIdx = fn.indexOf('const connect = ()')
    const body = fn.slice(connectIdx, connectIdx + 400)
    expect(body).toMatch(/current\?\.end\(\{\s*timeout:\s*0\s*\}\)\.catch\(/)
  })

  it('bails out immediately if already stopped, without incrementing epoch or opening a connection', () => {
    const connectIdx = fn.indexOf('const connect = ()')
    const body = fn.slice(connectIdx, fn.indexOf('\n', connectIdx + 10) + 60)
    expect(body).toMatch(/if\s*\(stopped\)\s*return/)
  })
})

describe('watchNotifications — connection options', () => {
  it('uses max: 1 (single dedicated connection, not pooled) and disables max_lifetime cycling', () => {
    expect(fn).toMatch(/max:\s*1,/)
    expect(fn).toMatch(/max_lifetime:\s*null,/)
  })

  it('dispatches onnotify to the matching per-channel handler, not a hardcoded single channel', () => {
    // Generalized for multi-channel support (config_changed, member_joined,
    // data_changed, kb_sync_job_queued): looks up handlers[channel] and bails
    // if that channel has no registered handler, instead of hardcoding a
    // single channel-name comparison.
    const onnotifyIdx = fn.indexOf('onnotify:')
    const body = fn.slice(onnotifyIdx, onnotifyIdx + 300)
    expect(body).toMatch(/const handler = handlers\[channel\]/)
    expect(body).toMatch(/if\s*\(!handler\)\s*return/)
    expect(body).not.toMatch(/channel !== 'config_changed'/)
  })

  it('resolves the connection URL via getDirectDatabaseUrl, not the pooled DATABASE_URL', () => {
    expect(fn).toContain('getDirectDatabaseUrl()')
    expect(fn).not.toContain('process.env.DATABASE_URL')
  })
})

describe('watchNotifications — cleanup function returned to callers', () => {
  it('sets stopped so no further reconnects are scheduled after shutdown', () => {
    const returnIdx = fn.lastIndexOf('return async () =>')
    expect(returnIdx).toBeGreaterThan(0)
    const cleanupBody = fn.slice(returnIdx, fn.length)
    expect(cleanupBody).toMatch(/stopped = true/)
  })

  it('clears both the heartbeat interval and any pending reconnect timeout', () => {
    const returnIdx = fn.lastIndexOf('return async () =>')
    const cleanupBody = fn.slice(returnIdx, fn.length)
    expect(cleanupBody).toMatch(/if\s*\(heartbeat\)\s*clearInterval\(heartbeat\)/)
    expect(cleanupBody).toMatch(/if\s*\(reconnectTimer\)\s*clearTimeout\(reconnectTimer\)/)
  })

  it('awaits ending the live connection so shutdown does not race an in-flight close', () => {
    const returnIdx = fn.lastIndexOf('return async () =>')
    const cleanupBody = fn.slice(returnIdx, fn.length)
    expect(cleanupBody).toMatch(/await current\?\.end\(\)/)
  })

  it('the caller in main() awaits the cleanup function during graceful shutdown (SIGINT/SIGTERM)', () => {
    const sigHandlerIdx = src.indexOf("for (const sig of ['SIGINT', 'SIGTERM'])")
    expect(sigHandlerIdx).toBeGreaterThanOrEqual(0)
    const handlerBody = src.slice(sigHandlerIdx, sigHandlerIdx + 300)
    expect(handlerBody).toMatch(/await stopListening\(\)/)
  })
})

describe('watchNotifications — graceful no-op when no direct URL is configured', () => {
  it('returns an inert async no-op cleanup instead of throwing when getDirectDatabaseUrl() is falsy', () => {
    const guardIdx = fn.indexOf('if (!url)')
    expect(guardIdx).toBeGreaterThanOrEqual(0)
    const guardBody = fn.slice(guardIdx, guardIdx + 200)
    expect(guardBody).toMatch(/return \(\) => Promise\.resolve\(\)/)
  })
})
