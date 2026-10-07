import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * pnpm-workspace.yaml pins several transitive dependencies to a minimum
 * patched version. An override only holds while it actually resolves in the
 * lockfile — a `pnpm install` after a dependency bump can silently re-widen
 * the resolved range if the override's selector stops matching. This test
 * reads the committed lockfile directly (not node_modules) so it catches
 * that drift in CI without needing a real install.
 */

const lockfile = fs.readFileSync(
  path.join(process.cwd(), 'pnpm-lock.yaml'),
  'utf8'
)

function parseVersion(v: string): [number, number, number] {
  const [major, minor, patch] = v.split('.').map((n) => parseInt(n, 10))
  return [major, minor || 0, patch || 0]
}

function isAtLeast(v: string, floor: string): boolean {
  const [a1, a2, a3] = parseVersion(v)
  const [b1, b2, b3] = parseVersion(floor)
  if (a1 !== b1) return a1 > b1
  if (a2 !== b2) return a2 > b2
  return a3 >= b3
}

/** Every top-level resolved version of `name` in the lockfile's package index. */
function resolvedVersions(name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `^ {2}'?${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[^'":\\s(]+)?)`,
    'gm'
  )
  const versions = new Set<string>()
  for (const match of lockfile.matchAll(re)) {
    versions.add(match[1])
  }
  return [...versions]
}

describe('dependency floors from pnpm-workspace.yaml overrides stay resolved', () => {
  it.each([
    ['hono', '4.13.5'],
    ['qs', '6.16.0'],
    ['baseline-browser-mapping', '2.11.0'],
  ])('%s resolves to >= %s', (name, floor) => {
    const versions = resolvedVersions(name)
    expect(versions.length, `no resolved instance of ${name} found in pnpm-lock.yaml`).toBeGreaterThan(0)
    const below = versions.filter((v) => !isAtLeast(v, floor))
    expect(below, `${name} instances below the patched floor: ${below.join(', ')}`).toEqual([])
  })

  // image-size was only reached through a dependency that newer releases of
  // the agent framework no longer have, so it can be absent from the lockfile
  // entirely. The override stays in place so the floor applies if it returns;
  // the check below only fails when an instance IS resolved below the floor.
  it('image-size, when resolved, is >= 2.0.3', () => {
    const below = resolvedVersions('image-size').filter((v) => !isAtLeast(v, '2.0.3'))
    expect(below, `image-size instances below the patched floor: ${below.join(', ')}`).toEqual([])
  })

  // @ai-sdk/provider-utils is pinned across two majors (3.x and 4.x, both
  // consumed directly by different packages) so each range needs its own floor.
  it.each([
    ['3.x', '3.0.28'],
    ['4.x', '4.0.33'],
  ])('@ai-sdk/provider-utils %s resolves to >= %s', (_label, floor) => {
    const versions = resolvedVersions('@ai-sdk/provider-utils').filter(
      (v) => parseVersion(v)[0] === parseVersion(floor)[0]
    )
    if (versions.length === 0) return // that major isn't resolved anywhere right now
    const below = versions.filter((v) => !isAtLeast(v, floor))
    expect(below, `@ai-sdk/provider-utils instances below the patched floor: ${below.join(', ')}`).toEqual([])
  })
})

describe('direct dependency versions stay at their patched floor', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  )

  it('csv-parse declares >= 7.0.2', () => {
    const range = pkg.dependencies['csv-parse']
    const version = range.replace(/^\^|~/, '')
    expect(isAtLeast(version, '7.0.2')).toBe(true)
  })

  it('vitest declares >= 4.1.11', () => {
    const range = pkg.devDependencies['vitest']
    const version = range.replace(/^\^|~/, '')
    expect(isAtLeast(version, '4.1.11')).toBe(true)
  })
})
