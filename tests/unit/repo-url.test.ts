import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GITHUB_URL, GITHUB_ISSUES_URL } from '@/lib/site'

/**
 * Every "view source" link on the public site points at the repository people
 * can actually open.
 *
 * The marketing copy carried the pre-migration repository path long after the
 * move. That path now redirects to the private archive, so the header link, the
 * footer's "Open source — view source", both landing-page CTAs and the
 * comparison pages all sent visitors to a page they could not read — on a site
 * whose pitch is that the product is open source.
 *
 * The URL is duplicated across TypeScript, MDX, JSON and Markdown because
 * documents cannot import a constant. This test is what keeps those copies
 * equal to the one definition in lib/site.ts.
 */

const repoRoot = process.cwd()

/** Paths that legitimately mention the old repository (this test included). */
const EXEMPT = new Set(['tests/unit/repo-url.test.ts'])

function trackedFiles(): string[] {
  return execSync('git ls-files', { cwd: repoRoot, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
}

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.mdx', '.md', '.json', '.txt', '.yml', '.yaml'])

describe('the public repository URL', () => {
  it('is the repository the git remote actually points at', () => {
    const remote = execSync('git remote get-url origin', { cwd: repoRoot, encoding: 'utf-8' }).trim()
    expect(remote.replace(/\.git$/, '').toLowerCase()).toBe(GITHUB_URL.toLowerCase())
  })

  it('never appears anywhere as the pre-migration path, which redirects to the private archive', () => {
    const offenders: string[] = []
    for (const file of trackedFiles()) {
      if (EXEMPT.has(file)) continue
      if (!TEXT_EXTENSIONS.has(path.extname(file))) continue
      const contents = readFileSync(path.join(repoRoot, file), 'utf-8')
      if (contents.includes('NathanTarbert/community-platform')) offenders.push(file)
    }
    expect(offenders, 'these files link to the archived repository').toEqual([])
  })

  it('is spelled one way everywhere, so the links stay identical', () => {
    // GitHub resolves owner and repo case-insensitively, so a mixed-case copy
    // works while quietly diverging from the constant — which is how three
    // spellings accumulated in the first place.
    const offenders: string[] = []
    for (const file of trackedFiles()) {
      if (EXEMPT.has(file)) continue
      if (!TEXT_EXTENSIONS.has(path.extname(file))) continue
      const contents = readFileSync(path.join(repoRoot, file), 'utf-8')
      for (const match of contents.matchAll(/https:\/\/github\.com\/answerLoops\/[A-Za-z-]+/gi)) {
        const url = match[0]
        if (!url.startsWith(GITHUB_URL)) offenders.push(`${file}: ${url}`)
      }
    }
    expect(offenders, 'these differ from lib/site.ts').toEqual([])
  })

  it('backs the marketing chrome, which re-exports rather than redeclaring it', () => {
    const src = readFileSync(path.join(repoRoot, 'components/marketing/chrome.tsx'), 'utf-8')
    expect(src).toContain("export { GITHUB_URL } from '@/lib/site'")
    expect(src, 'a second definition is what drifted last time').not.toMatch(
      /const GITHUB_URL\s*=\s*['"]https/,
    )
  })

  it('builds the issues link from the same base', () => {
    expect(GITHUB_ISSUES_URL).toBe(`${GITHUB_URL}/issues`)
  })
})
