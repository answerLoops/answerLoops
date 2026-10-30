// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')

describe('github:backfill-threads package script', () => {
  it('points at a script file that exists', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const cmd: string = pkg.scripts['github:backfill-threads']
    expect(cmd).toBe('tsx scripts/backfill-github-comment-threads.ts')
    expect(existsSync(join(root, cmd.split(' ').pop()!))).toBe(true)
  })
})

// Runs the script's main() with mocked backfill and a stubbed process.exit.
const h = vi.hoisted(() => ({ backfill: vi.fn(), resolver: vi.fn() }))
vi.mock('@/lib/github/thread-backfill', () => ({
  backfillGithubCommentThreads: h.backfill,
  githubParentResolver: h.resolver,
}))

class Exit extends Error { constructor(public code: number) { super(`exit ${code}`) } }

async function runScript(args: string[]) {
  const argv = process.argv
  process.argv = ['node', 'script', ...args]
  const errors: string[] = []
  const logs: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')) })
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')) })
  let code: number | undefined
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    // The first exit ends the run; the script's catch handler calls exit again
    // for the thrown Exit, which must be swallowed and must not overwrite the code.
    if (code !== undefined) return undefined
    code = c ?? 0
    throw new Exit(code)
  }) as never)
  vi.resetModules()
  try {
    await import('../../scripts/backfill-github-comment-threads')
    // main() is async; let it settle (its catch handler also calls exit).
    await new Promise((r) => setTimeout(r, 20))
  } finally {
    process.argv = argv
  }
  return { code, errors, logs }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolver.mockReturnValue('resolver')
  h.backfill.mockResolvedValue({ attached: 2, wouldAttach: 3, noParentTicket: 1, unresolved: 0, hasReplies: 4 })
})
afterEach(() => vi.restoreAllMocks())

describe('backfill-github-comment-threads script argument validation', () => {
  it.each([
    [[]],
    [['--dry-run']],
    [['--org=']],
    [['--org=abc']],
    [['--org=1.5']],
    [['--org=0']],
    [['--org=-3']],
  ])('rejects %j and never runs the backfill', async (args) => {
    const { code, errors } = await runScript(args)
    expect(code).toBe(1)
    expect(errors.join('\n')).toContain('--org=<id>')
    expect(h.backfill).not.toHaveBeenCalled()
  })

  it('runs for exactly the given org, scoping the resolver to the same org', async () => {
    const { code, logs } = await runScript(['--org=7'])
    expect(code).toBe(0)
    expect(h.resolver).toHaveBeenCalledWith(7)
    expect(h.backfill).toHaveBeenCalledWith(7, 'resolver', { dryRun: false })
    expect(logs.join('\n')).toContain('Done for organization 7')
  })

  it('passes dryRun and reports the would-attach count', async () => {
    const { logs } = await runScript(['--org=7', '--dry-run'])
    expect(h.backfill).toHaveBeenCalledWith(7, 'resolver', { dryRun: true })
    const out = logs.join('\n')
    expect(out).toContain('Dry run for organization 7')
    expect(out).toMatch(/attached to their issue's ticket:\s+3/)
  })
})
