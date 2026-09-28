import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Dependabot exists mainly to stop the CI security scanners (semgrep, zizmor,
// the trivy-action digest) from drifting silently. These lock in that wiring:
// the tools are version-pinned, the workflow installs the pinned file, and
// Dependabot watches both the pip file and the GitHub Actions. String
// assertions, matching the other workflow tests in this repo.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

describe('.github/security-tools/requirements.txt', () => {
  const reqs = read('.github/security-tools/requirements.txt')

  it('pins semgrep and zizmor to an exact version', () => {
    expect(reqs).toMatch(/^semgrep==\d+\.\d+\.\d+/m)
    expect(reqs).toMatch(/^zizmor==\d+\.\d+\.\d+/m)
  })

  it('is what the security workflow installs — no bare `pip install <tool>` left', () => {
    const wf = read('.github/workflows/security.yml')
    expect(wf).not.toMatch(/pip install (semgrep|zizmor)(\s|$)/)
    const installs = [...wf.matchAll(/pip install -r (\S+)/g)].map((m) => m[1])
    expect(installs.length).toBe(2) // semgrep job + zizmor job
    for (const p of installs) expect(p).toBe('.github/security-tools/requirements.txt')
  })
})

describe('.github/dependabot.yml', () => {
  const cfg = read('.github/dependabot.yml')

  it('is a v2 config', () => {
    expect(cfg).toMatch(/^version:\s*2\s*$/m)
  })

  it('watches the pinned security-tools pip file weekly', () => {
    const pip = cfg.slice(cfg.indexOf('package-ecosystem: pip'), cfg.indexOf('package-ecosystem: github-actions'))
    expect(pip).toContain('directory: /.github/security-tools')
    expect(pip).toMatch(/interval:\s*weekly/)
  })

  it('watches the SHA-pinned GitHub Actions (keeps the trivy-action digest moving)', () => {
    expect(cfg).toContain('package-ecosystem: github-actions')
    const gha = cfg.slice(
      cfg.indexOf('package-ecosystem: github-actions'),
      cfg.indexOf('package-ecosystem: npm')
    )
    expect(gha).toMatch(/directory:\s*\/\s*$/m)
  })

  it('sets a cooldown on every ecosystem so a freshly published version waits before it is proposed', () => {
    const entries = cfg.split('- package-ecosystem:').slice(1)
    expect(entries.length).toBe(3)
    for (const e of entries) expect(e).toMatch(/cooldown:\s*\n\s*default-days:\s*7/)
  })

  it('watches npm weekly, grouped into one PR, capped so it cannot flood the queue', () => {
    expect(cfg).toContain('package-ecosystem: npm')
    const npm = cfg.slice(cfg.indexOf('package-ecosystem: npm'))
    expect(npm).toMatch(/directory:\s*\/\s*$/m)
    expect(npm).toMatch(/interval:\s*weekly/)
    expect(npm).toMatch(/open-pull-requests-limit:\s*\d+/)
    expect(npm).toMatch(/groups:\s*\n\s*npm-dependencies:\s*\n\s*patterns:\s*\n\s*-\s*"\*"/)
  })

  it('ignores every package pinned in pnpm-workspace.yaml overrides, so Dependabot cannot fight a documented compatibility pin', () => {
    const workspace = read('pnpm-workspace.yaml')
    const overridesBlock = workspace.slice(workspace.indexOf('\noverrides:'))
    // Pull the bare package name out of each override key, including the
    // range-scoped ones (e.g. '@ai-sdk/provider-utils@>=3.0.0 <3.0.28').
    const overriddenNames = [
      ...overridesBlock.matchAll(/^ {2}'?(@?[^:'\s@]+(?:\/[^:'\s@]+)?)/gm),
    ].map((m) => m[1])

    expect(overriddenNames.length).toBeGreaterThan(0)

    const npm = cfg.slice(cfg.indexOf('package-ecosystem: npm'))
    for (const name of new Set(overriddenNames)) {
      expect(npm, `expected dependabot.yml to ignore "${name}"`).toContain(
        `dependency-name: "${name}"`
      )
    }
  })
})
