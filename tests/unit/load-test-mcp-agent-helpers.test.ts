import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { transformSync } from 'esbuild'

// Coverage for scripts/load-test-mcp-agent.ts (Roadmap pre-launch checklist
// item 1: load test /api/mcp and /api/v1/agent/* before committing to tiered
// rate limits).
//
// This script is a CLI load-test tool, not something to load-test itself: its
// main() does real DB writes (test orgs/subscriptions/API keys), real HTTP
// traffic against --url, and reads process.argv / .env. Importing the module
// directly would run main() as a side effect (it's invoked unconditionally at
// the bottom of the file) — there's no live DB or network in this test
// environment, so that would either hang or throw for reasons unrelated to
// the two things in this file that are actually pure and worth pinning:
//
//   - percentile(): the math behind the p50/p95/p99 columns in the report
//     table. Wrong here and every load-test run reports fabricated latency
//     numbers without anyone noticing, since there's no other check on it.
//   - parseArgs(): the --flag defaults and parsing this tool is driven by.
//
// Both are extracted from the file's own source text with a regex and
// evaluated in isolation via `new Function`, rather than imported — this
// exercises the actual shipped implementation without ever reaching main()
// or its DB/network side effects.

const ROOT = process.cwd()
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'load-test-mcp-agent.ts')

function readScript(): string {
  expect(fs.existsSync(SCRIPT_PATH)).toBe(true)
  return fs.readFileSync(SCRIPT_PATH, 'utf-8')
}

function extractFunction(src: string, signature: string): string {
  const startIdx = src.indexOf(signature)
  expect(startIdx, `could not find "${signature}" in scripts/load-test-mcp-agent.ts`).toBeGreaterThan(-1)

  // Brace-match from the first '{' after the signature to find the function's
  // own closing brace, rather than a fixed slice length that could clip it or
  // pull in the next function too.
  const braceOpenIdx = src.indexOf('{', startIdx)
  let depth = 0
  let endIdx = -1
  for (let i = braceOpenIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    if (src[i] === '}') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  expect(endIdx, `could not find matching closing brace for "${signature}"`).toBeGreaterThan(-1)
  return src.slice(startIdx, endIdx + 1)
}

/**
 * Strips TypeScript types from an extracted function's source (which can
 * itself contain typed inner arrow functions, as parseArgs does) using the
 * project's own esbuild dependency, then evaluates it in isolation — the
 * actual shipped implementation, not a hand-transcribed copy, but without
 * ever reaching main() or its DB/network side effects.
 */
function evalTsFunction<T>(tsSrc: string): T {
  const { code } = transformSync(tsSrc, { loader: 'ts' })
  // eslint-disable-next-line no-new-func
  return new Function(`return (${code})`)() as T
}

describe('scripts/load-test-mcp-agent.ts exists and is a real CLI tool, not a placeholder', () => {
  it('has a main() guarded to real DB/network I/O, which this test suite deliberately never invokes', () => {
    const s = readScript()
    expect(s).toContain('async function main(): Promise<void>')
    expect(s).toContain('main().catch(')
  })
})

describe('percentile(): the math behind the p50/p95/p99 report columns', () => {
  function percentile(sorted: number[], p: number): number {
    const src = readScript()
    const fnSrc = extractFunction(src, 'function percentile(sorted: number[], p: number): number')
    const built = evalTsFunction<(s: number[], p: number) => number>(fnSrc)
    return built(sorted, p)
  }

  it('returns 0 for an empty sample set instead of throwing or returning NaN', () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([], 99)).toBe(0)
  })

  it('p50 of a sorted array picks the value at the midpoint', () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(percentile(sorted, 50)).toBe(30)
  })

  it('p99 (and p100-adjacent percentiles) never index past the end of the array', () => {
    const sorted = [10, 20, 30, 40, 50]
    // A naive Math.floor((p/100)*length) at p=100 would index one past the
    // last element (out of bounds -> undefined), silently reporting NaN or
    // undefined instead of the true max latency.
    expect(percentile(sorted, 99)).toBe(50)
    expect(percentile(sorted, 100)).toBe(50)
  })

  it('single-element sample sets return that element at any percentile', () => {
    expect(percentile([42], 1)).toBe(42)
    expect(percentile([42], 99)).toBe(42)
  })
})

describe('parseArgs(): CLI flag defaults', () => {
  function parseArgs(argv: string[]) {
    const src = readScript()
    const fnSrc = extractFunction(src, 'function parseArgs(argv: string[]): Args')
    const built = evalTsFunction<
      (a: string[]) => {
        url: string
        orgsPerTier: number
        durationSec: number
        overshoot: number
        routes: Set<string>
        keep: boolean
      }
    >(fnSrc)
    return built(argv)
  }

  it('defaults match the documented header comment when no flags are passed', () => {
    const args = parseArgs([])
    expect(args.url).toBe('http://localhost:3000')
    expect(args.orgsPerTier).toBe(2)
    expect(args.durationSec).toBe(75)
    expect(args.overshoot).toBe(1.5)
    expect([...args.routes]).toEqual(['mcp', 'agent'])
    expect(args.keep).toBe(false)
  })

  it('strips a trailing slash from --url so route paths never end up double-slashed', () => {
    const args = parseArgs(['--url', 'http://example.com/'])
    expect(args.url).toBe('http://example.com')
  })

  it('parses --routes into just the requested subset', () => {
    const args = parseArgs(['--routes', 'agent'])
    expect([...args.routes]).toEqual(['agent'])
  })

  it('--keep is a boolean presence flag, not a value flag', () => {
    expect(parseArgs(['--keep']).keep).toBe(true)
    expect(parseArgs([]).keep).toBe(false)
  })
})
