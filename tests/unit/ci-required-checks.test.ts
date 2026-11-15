import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Branch protection on main requires checks by job name, not by workflow
 * event. CI fans the unit tests out across shards and runs the build in
 * parallel, so the single required "Test + build" check is an aggregate job.
 * If that job is renamed, loses `always()`, or stops depending on both halves,
 * main either waits forever on a check that never reports or merges with a
 * failed half treated as skipped. Neither shows up as a red check, so each is
 * pinned here. Workflow files are read as text.
 */

const root = process.cwd()
const read = (rel: string) => readFile(path.join(root, rel), 'utf8')

/** Top-level job body, or '' when missing. */
function job(workflow: string, id: string): string {
  const start = workflow.indexOf(`\n  ${id}:\n`)
  if (start === -1) return ''
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

const REQUIRED_CI_NAMES = ['Test + build']
const REQUIRED_SECURITY_NAMES = [
  'Semgrep SAST',
  'Trivy — deps + secrets + Dockerfile',
  'pnpm audit',
  'Supply-chain trust audit',
  'Zizmor — GitHub Actions workflow audit',
]

describe('ci.yml required check', () => {
  it.each(REQUIRED_CI_NAMES)('still defines a job named %s', async (name) => {
    expect(await read('.github/workflows/ci.yml')).toContain(`name: ${name}\n`)
  })

  it('gates Test + build on both unit-tests and build, even when they fail', async () => {
    const gate = job(await read('.github/workflows/ci.yml'), 'test-and-build')
    expect(gate, 'test-and-build job is missing').not.toBe('')
    expect(gate).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/)
    expect(gate).toMatch(/needs:\s*\[unit-tests,\s*build\]/)
    expect(gate).toContain('needs.unit-tests.result')
    expect(gate).toContain('needs.build.result')
    expect(gate).toContain('exit 1')
  })

  it('shards the unit tests and runs every shard', async () => {
    const unit = job(await read('.github/workflows/ci.yml'), 'unit-tests')
    expect(unit).toMatch(/shard:\s*\[1,\s*2,\s*3\]/)
    expect(unit).toContain('--shard=${{ matrix.shard }}/3')
    // A failing shard must not cancel the others, or the report is partial.
    expect(unit).toMatch(/fail-fast:\s*false/)
  })
})

describe('security.yml required checks', () => {
  it.each(REQUIRED_SECURITY_NAMES)('still defines a job named %s', async (name) => {
    expect(await read('.github/workflows/security.yml')).toContain(`name: ${name}\n`)
  })
})

describe.each(['ci.yml', 'security.yml'])('%s triggers', (file) => {
  it('runs push only on main so a PR branch is not checked twice', async () => {
    const text = await read(`.github/workflows/${file}`)
    const on = text.slice(text.indexOf('\non:\n'), text.indexOf('\npermissions:'))
    expect(on).toMatch(/push:\s*\n\s*branches:\s*\[main\]/)
    expect(on).not.toContain("push:\n    branches: ['**']")
    expect(on).toMatch(/pull_request:\s*\n\s*branches:\s*\['\*\*'\]/)
  })
})
