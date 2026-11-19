import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { shouldScanPrBody } from '../../scripts/disclosure-body-policy.mjs'

/**
 * Dependabot copies the upstream project's release notes into every PR body.
 * That text is not ours, and the checker matches vocabulary rather than
 * meaning, so it fails PRs nobody can fix. The exemption below is deliberately
 * narrow; these tests pin down exactly how narrow.
 *
 * The fixture is a generic phrase carrying the checker's vocabulary, marked
 * `disclosure-ok` like the fixtures in disclosure-check.test.ts so it passes
 * the added-lines scan visibly rather than through a filename exemption.
 */
const FLAGGED = 'notes that mention an attacker in passing' // disclosure-ok: fixture
const CLEAN = 'Bumps a tool from 1.0.0 to 1.1.0'

const BOT = { author: 'dependabot[bot]', authorType: 'Bot' }

describe('shouldScanPrBody', () => {
  it('skips the body of a PR the Dependabot app opened or updated', () => {
    expect(shouldScanPrBody({ ...BOT, action: 'opened', actor: 'dependabot[bot]' })).toBe(false)
    expect(shouldScanPrBody({ ...BOT, action: 'synchronize', actor: 'dependabot[bot]' })).toBe(false)
    expect(shouldScanPrBody({ ...BOT, action: 'edited', actor: 'dependabot[bot]' })).toBe(false)
  })

  it('still skips it when a maintainer pushes to or updates the branch', () => {
    // The body was written by the bot; the person did not touch it.
    expect(shouldScanPrBody({ ...BOT, action: 'synchronize', actor: 'a-maintainer' })).toBe(false)
  })

  it('scans the body when a person edits a bot PR body', () => {
    expect(shouldScanPrBody({ ...BOT, action: 'edited', actor: 'a-maintainer' })).toBe(true)
  })

  it('scans every ordinary PR', () => {
    expect(shouldScanPrBody({ author: 'a-contributor', authorType: 'User', action: 'opened', actor: 'a-contributor' })).toBe(true)
  })

  it('is not fooled by a look-alike login or a user account', () => {
    expect(shouldScanPrBody({ author: 'dependabot[bot]', authorType: 'User', action: 'opened', actor: 'dependabot[bot]' })).toBe(true)
    expect(shouldScanPrBody({ author: 'dependabot', authorType: 'Bot', action: 'opened', actor: 'dependabot' })).toBe(true)
    expect(shouldScanPrBody({ author: 'other-bot[bot]', authorType: 'Bot', action: 'opened', actor: 'other-bot[bot]' })).toBe(true)
  })

  it('scans when nothing is known about the author', () => {
    expect(shouldScanPrBody({})).toBe(true)
    expect(shouldScanPrBody()).toBe(true)
  })
})

const SCRIPT = path.join(process.cwd(), 'scripts/ci-disclosure-check.mjs')

/** Runs the real CI script as the workflow does, through environment values. */
function run(env: Record<string, string>) {
  const res = spawnSync('node', [SCRIPT], {
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', PR_TITLE: 'chore: bump a tool', ...env },
    encoding: 'utf-8',
  })
  return { code: res.status, out: `${res.stdout}${res.stderr}` }
}

describe('ci-disclosure-check with the Dependabot carve-out', () => {
  const asBot = { PR_AUTHOR: 'dependabot[bot]', PR_AUTHOR_TYPE: 'Bot', PR_ACTION: 'opened', PR_ACTOR: 'dependabot[bot]' }

  it('passes a Dependabot PR whose body carries flagged vocabulary', () => {
    const r = run({ ...asBot, PR_BODY: FLAGGED })
    expect(r.code).toBe(0)
    expect(r.out).toContain('PR body not scanned')
  })

  it('still fails a Dependabot PR whose title carries it', () => {
    const r = run({ ...asBot, PR_TITLE: FLAGGED, PR_BODY: CLEAN })
    expect(r.code).toBe(1)
    expect(r.out).toContain('PR title')
  })

  it('fails when a person edits the bot PR body', () => {
    const r = run({ ...asBot, PR_ACTION: 'edited', PR_ACTOR: 'a-maintainer', PR_BODY: FLAGGED })
    expect(r.code).toBe(1)
    expect(r.out).toContain('PR body')
  })

  it('fails an ordinary PR with the same body', () => {
    const r = run({ PR_AUTHOR: 'a-contributor', PR_AUTHOR_TYPE: 'User', PR_ACTION: 'opened', PR_ACTOR: 'a-contributor', PR_BODY: FLAGGED })
    expect(r.code).toBe(1)
    expect(r.out).toContain('PR body')
  })

  it('fails when the author variables are missing entirely', () => {
    const r = run({ PR_BODY: FLAGGED })
    expect(r.code).toBe(1)
  })

  it('passes a clean Dependabot PR and does not claim to have skipped anything for a clean user PR', () => {
    expect(run({ ...asBot, PR_BODY: CLEAN }).code).toBe(0)
    const user = run({ PR_AUTHOR: 'a-contributor', PR_AUTHOR_TYPE: 'User', PR_ACTION: 'opened', PR_ACTOR: 'a-contributor', PR_BODY: CLEAN })
    expect(user.code).toBe(0)
    expect(user.out).not.toContain('PR body not scanned')
  })
})
