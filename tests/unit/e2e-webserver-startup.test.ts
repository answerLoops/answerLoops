import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the e2e web server startup budget. The webServer runs a full
 * `next build && next start`, and with a 180s limit the same commit has both
 * passed and timed out on a cold CI runner. The fix is three coupled pieces:
 * a larger timeout, piped output so a timeout shows where time went, and a
 * persisted `.next/cache` so the common case is an incremental build. Any one
 * of them being reverted brings the flake back without failing anything
 * locally, so each is pinned here.
 *
 * playwright.config.ts resolves a database URL at import, so it is read as
 * text and never imported.
 */

const MIN_TIMEOUT_MS = 300_000

const stripLineComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|#)/.test(line))
    .join('\n')

/** The body of the `webServer: { ... }` block, comments removed. */
export function webServerBlock(config: string): string {
  const code = stripLineComments(config)
  const start = code.search(/\bwebServer\s*:\s*\{/)
  if (start === -1) return ''
  const open = code.indexOf('{', start)
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return code.slice(open, i + 1)
    }
  }
  return ''
}

/** The webServer timeout in ms, or null when it is not a numeric literal. */
export function webServerTimeoutMs(config: string): number | null {
  const m = webServerBlock(config).match(/\btimeout\s*:\s*(\d[\d_]*)\s*[,}\n]/)
  return m ? Number(m[1].replace(/_/g, '')) : null
}

export function timeoutIsGenerous(config: string): boolean {
  const ms = webServerTimeoutMs(config)
  return ms !== null && ms >= MIN_TIMEOUT_MS && ms !== 180_000
}

export function pipesOutput(config: string): boolean {
  const block = webServerBlock(config)
  return /\bstdout\s*:\s*'pipe'/.test(block) && /\bstderr\s*:\s*'pipe'/.test(block)
}

/** Slice a top-level job out of the workflow, or '' when it is missing. */
export function sliceJob(ci: string, name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`)
  if (start === -1) return ''
  const rest = ci.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

/** Steps of a job as text chunks, comments removed. */
export function steps(job: string): string[] {
  return stripLineComments(job)
    .split(/\n(?= {6}- )/)
    .filter((chunk) => /^ {6}- /.test(chunk))
}

const CACHE_USES = /uses:\s*actions\/cache@[0-9a-f]{40}\b/
const isNextCacheStep = (s: string): boolean =>
  CACHE_USES.test(s) && /^\s*path:\s*\.next\/cache\s*$/m.test(s)

export function nextCacheStepIndex(job: string): number {
  return steps(job).findIndex(isNextCacheStep)
}

export function cacheIsOrderedCorrectly(job: string): boolean {
  const all = steps(job)
  const cache = all.findIndex(isNextCacheStep)
  const db = all.findIndex((s) => /name:\s*Create test database\b/.test(s))
  const run = all.findIndex((s) => /^ {6}- run: pnpm test:e2e\s*$/.test(s))
  return cache > -1 && db > -1 && run > -1 && db < cache && cache < run
}

export function cacheKeysAreValid(job: string): boolean {
  const step = steps(job).find(isNextCacheStep)
  if (!step) return false
  const key = step.match(/^\s*key:\s*(.+)$/m)?.[1] ?? ''
  if (!key.includes("hashFiles('pnpm-lock.yaml')")) return false
  const prefix = key.split("${{ hashFiles('pnpm-lock.yaml') }}")[0]
  if (!prefix) return false
  const restore = step.match(/^\s*restore-keys:\s*\|?\s*\n((?:\s+.+\n?)+)/m)?.[1] ?? ''
  return restore
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .some((l) => l.startsWith(prefix) && l.includes("hashFiles('pnpm-lock.yaml')"))
}

/** Count of Next.js cache steps across the whole workflow, outside test-e2e. */
export function nextCacheStepsOutside(ci: string, jobName: string): number {
  const inside = sliceJob(ci, jobName)
  return (ci.replace(inside, '').match(/path:\s*\.next\/cache/g) ?? []).length
}

const root = process.cwd()
const readText = (rel: string) => readFile(path.join(root, rel), 'utf8')

describe('e2e webServer startup budget (playwright.config.ts)', () => {
  it('allows at least 300s for build plus boot, and not the old 180s', async () => {
    const config = await readText('playwright.config.ts')
    const ms = webServerTimeoutMs(config)
    expect(ms, 'webServer.timeout must be a numeric literal').not.toBeNull()
    expect(ms!).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS)
    expect(ms).not.toBe(180_000)
  })

  it('pipes stdout and stderr so build output reaches the CI log', async () => {
    expect(pipesOutput(await readText('playwright.config.ts'))).toBe(true)
  })
})

describe('e2e Next.js build cache (ci.yml test-e2e job)', () => {
  it('has a SHA-pinned actions/cache step for .next/cache in test-e2e', async () => {
    const job = sliceJob(await readText('.github/workflows/ci.yml'), 'test-e2e')
    expect(job, 'test-e2e job is missing').not.toBe('')
    expect(nextCacheStepIndex(job)).toBeGreaterThan(-1)
  })

  it('restores the cache after the test database exists and before the suite runs', async () => {
    const job = sliceJob(await readText('.github/workflows/ci.yml'), 'test-e2e')
    expect(cacheIsOrderedCorrectly(job)).toBe(true)
  })

  it('keys on the lockfile hash and falls back to a same-prefix restore key', async () => {
    const job = sliceJob(await readText('.github/workflows/ci.yml'), 'test-e2e')
    expect(cacheKeysAreValid(job)).toBe(true)
  })

  it('keeps the build cache to test-e2e and the build job, and no other job', async () => {
    const ci = await readText('.github/workflows/ci.yml')
    // The build job caches its own `.next/cache` on a separate key, so exactly
    // one cache step may exist outside test-e2e, and it must live in `build`.
    expect(nextCacheStepsOutside(ci, 'test-e2e')).toBe(1)
    expect(nextCacheStepIndex(sliceJob(ci, 'build'))).toBeGreaterThan(-1)
  })
})

describe('guards fail on regressions (mutations)', () => {
  const GOOD_CONFIG = `
export default defineConfig({
  webServer: {
    command: 'next build && next start',
    // timeout: 180_000 in an old comment must not count
    timeout: 420_000,
    stdout: 'pipe',
    stderr: 'pipe',
    reuseExistingServer: true,
  },
})
`
  const SHA = '55cc8345863c7cc4c66a329aec7e433d2d1c52a9'
  const HASH = "${{ hashFiles('pnpm-lock.yaml') }}"
  const GOOD_CI = `
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:e2e:typecheck

  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - name: Create test database
        run: psql -c "CREATE DATABASE community_test"

      - name: Cache the Next.js build cache
        uses: actions/cache@${SHA}  # v6.1.0
        with:
          path: .next/cache
          key: nextjs-e2e-\${{ runner.os }}-${HASH}-\${{ hashFiles('app/**') }}
          restore-keys: |
            nextjs-e2e-\${{ runner.os }}-${HASH}-

      - run: pnpm test:e2e
`
  const e2e = (ci: string) => sliceJob(ci, 'test-e2e')

  it('baseline fixtures pass every guard', () => {
    expect(timeoutIsGenerous(GOOD_CONFIG)).toBe(true)
    expect(pipesOutput(GOOD_CONFIG)).toBe(true)
    expect(nextCacheStepIndex(e2e(GOOD_CI))).toBeGreaterThan(-1)
    expect(cacheIsOrderedCorrectly(e2e(GOOD_CI))).toBe(true)
    expect(cacheKeysAreValid(e2e(GOOD_CI))).toBe(true)
    expect(nextCacheStepsOutside(GOOD_CI, 'test-e2e')).toBe(0)
  })

  it('catches the timeout reverted to 180_000', () => {
    expect(timeoutIsGenerous(GOOD_CONFIG.replace('420_000', '180_000'))).toBe(false)
  })

  it('catches a timeout that is not a numeric literal', () => {
    expect(timeoutIsGenerous(GOOD_CONFIG.replace('420_000', '60 * 7 * 1000'))).toBe(false)
  })

  it('ignores a generous timeout that only appears in a comment', () => {
    const mutated = GOOD_CONFIG.replace('timeout: 420_000,', '// timeout: 420_000,\n    timeout: 180_000,')
    expect(timeoutIsGenerous(mutated)).toBe(false)
  })

  it('catches stdout or stderr being removed or ignored', () => {
    expect(pipesOutput(GOOD_CONFIG.replace("stdout: 'pipe',", ''))).toBe(false)
    expect(pipesOutput(GOOD_CONFIG.replace("stderr: 'pipe',", "stderr: 'ignore',"))).toBe(false)
  })

  it('catches the cache step moved after the run step', () => {
    const cacheStart = GOOD_CI.indexOf('      - name: Cache the Next.js build cache')
    const runStart = GOOD_CI.indexOf('      - run: pnpm test:e2e\n')
    const cacheStep = GOOD_CI.slice(cacheStart, runStart)
    const moved = GOOD_CI.slice(0, cacheStart) + GOOD_CI.slice(runStart) + '\n' + cacheStep
    expect(cacheIsOrderedCorrectly(e2e(moved))).toBe(false)
  })

  it('catches the cache step moved before the database step', () => {
    const dbStart = GOOD_CI.indexOf('      - name: Create test database')
    const cacheStart = GOOD_CI.indexOf('      - name: Cache the Next.js build cache')
    const runStart = GOOD_CI.indexOf('      - run: pnpm test:e2e\n')
    const db = GOOD_CI.slice(dbStart, cacheStart)
    const cache = GOOD_CI.slice(cacheStart, runStart)
    const moved = GOOD_CI.slice(0, dbStart) + cache + db + GOOD_CI.slice(runStart)
    expect(cacheIsOrderedCorrectly(e2e(moved))).toBe(false)
  })

  it('catches the cache path changed or the step removed', () => {
    expect(nextCacheStepIndex(e2e(GOOD_CI.replace('path: .next/cache', 'path: .next')))).toBe(-1)
    expect(cacheIsOrderedCorrectly(e2e(GOOD_CI.replace('path: .next/cache', 'path: node_modules')))).toBe(false)
  })

  it('catches the cache action pinned to a tag instead of a commit SHA', () => {
    expect(nextCacheStepIndex(e2e(GOOD_CI.replace(`actions/cache@${SHA}`, 'actions/cache@v4')))).toBe(-1)
  })

  it('does not mistake the lint job pnpm test:e2e:typecheck line for the run step', () => {
    const noRun = GOOD_CI.replace('      - run: pnpm test:e2e\n', '      - run: pnpm test:e2e:typecheck\n')
    expect(cacheIsOrderedCorrectly(e2e(noRun))).toBe(false)
  })

  it('catches a key without the lockfile hash and a restore key with a different prefix', () => {
    const noHash = GOOD_CI.replace(/key: nextjs-e2e-.*\n/, 'key: nextjs-e2e-static\n')
    expect(cacheKeysAreValid(e2e(noHash))).toBe(false)
    const noRestore = GOOD_CI.replace(/ {10}nextjs-e2e-.*\n/, '')
    expect(cacheKeysAreValid(e2e(noRestore))).toBe(false)
    const wrongPrefix = GOOD_CI.replace(/( {10})nextjs-e2e-/, '$1other-')
    expect(cacheKeysAreValid(e2e(wrongPrefix))).toBe(false)
  })

  it('catches the cache step living in another job instead of test-e2e', () => {
    const cacheStart = GOOD_CI.indexOf('      - name: Cache the Next.js build cache')
    const runStart = GOOD_CI.indexOf('      - run: pnpm test:e2e\n')
    const cache = GOOD_CI.slice(cacheStart, runStart)
    const moved =
      GOOD_CI.slice(0, cacheStart) +
      GOOD_CI.slice(runStart) +
      '\n  other:\n    steps:\n' +
      cache
    expect(nextCacheStepIndex(e2e(moved))).toBe(-1)
    expect(nextCacheStepsOutside(moved, 'test-e2e')).toBe(1)
  })
})
