import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the Actions runtime the workflows execute on.
 *
 * This is the runtime GitHub runs the action's own JavaScript on, not the Node
 * the jobs install — `node-version: 22` in the workflows is a separate,
 * deliberate choice and is untouched by any of this.
 *
 * GitHub deprecated the Node 20 runtime and currently forces Node 20 actions
 * onto Node 24 anyway, so a workflow pinned to a Node 20 major keeps passing —
 * it just runs on a runtime it was never tested against, behind a shim that is
 * explicitly temporary. Nothing goes red when someone re-pins an action back
 * to a Node 20 major, which is exactly why this needs a test rather than a
 * comment.
 *
 * The floors below are the first major of each action whose `action.yml`
 * declares `runs.using: node24`, read from the action repositories rather than
 * inferred from release notes — several actions announced Node 24 support a
 * major before the runtime actually changed.
 */
const NODE24_FLOOR: Record<string, number> = {
  'actions/checkout': 5,
  'actions/setup-node': 5,
  'actions/upload-artifact': 6,
  'actions/download-artifact': 7,
  'actions/cache': 5,
  'pnpm/action-setup': 5,
  'docker/setup-buildx-action': 4,
  'docker/login-action': 4,
  'docker/build-push-action': 7,
  'docker/metadata-action': 6,
}

/**
 * Composite actions run their steps on the runner's own shell and declare no
 * Node runtime, so the deprecation does not reach them and there is no major
 * to floor.
 */
const COMPOSITE_ACTIONS = new Set(['aquasecurity/trivy-action'])

interface Use {
  file: string
  line: number
  /** `owner/repo`, or the raw ref for local and non-registry uses. */
  ref: string
  /** Empty for `@`-less refs such as `./.github/actions/foo`. */
  sha: string
  comment: string
}

async function uses(): Promise<Use[]> {
  const dir = path.join(process.cwd(), '.github/workflows')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  const found: Use[] = []

  for (const file of files) {
    const lines = (await readFile(path.join(dir, file), 'utf8')).split('\n')
    lines.forEach((text, index) => {
      // Deliberately matches every `uses:`, including `@`-less refs. Matching
      // only `owner/repo@sha` would let a local or registry-style `uses:` skip
      // all three assertions, which defeats the point of the guard.
      const match = text.match(/^\s*(?:-\s+)?uses:\s*(\S+?)(?:@(\S+))?(?:\s+#\s*(.*))?$/)
      if (!match) return
      found.push({
        file,
        line: index + 1,
        ref: match[1],
        sha: match[2] ?? '',
        comment: (match[3] ?? '').trim(),
      })
    })
  }

  return found
}

/** Local composite actions ship in this repo, so there is no third-party SHA to pin. */
const isLocal = (use: Use) => use.ref.startsWith('./')

describe('workflow action runtimes', () => {
  it('pins every third-party action to a full commit SHA with a readable version comment', async () => {
    for (const use of await uses()) {
      const where = `${use.file}:${use.line} (${use.ref})`

      if (isLocal(use)) {
        // A local action is fine, but it is only as safe as its own contents —
        // this test does not recurse into it to check what it pins.
        expect(use.sha, `${where} is a local action and must not carry an @ref`).toBe('')
        continue
      }

      expect(
        use.sha,
        `${where} is not pinned to a full commit SHA — third-party actions must be SHA-pinned, ` +
          'and a local action must start with ./',
      ).toMatch(/^[a-f0-9]{40}$/)
      expect(use.comment, `${where} has no version comment saying what the SHA is`).not.toBe('')
    }
  })

  it('keeps every Node-based action on a major that ships the Node 24 runtime', async () => {
    for (const use of await uses()) {
      if (isLocal(use) || COMPOSITE_ACTIONS.has(use.ref)) continue

      const floor = NODE24_FLOOR[use.ref]
      const where = `${use.file}:${use.line} (${use.ref})`

      // An action nobody has classified is the real hazard: it can be added on
      // a Node 20 major and this test would otherwise wave it through.
      expect(
        floor,
        `${where} is not in NODE24_FLOOR — check its action.yml for runs.using and add it, ` +
          'or add it to COMPOSITE_ACTIONS if it declares using: composite',
      ).toBeDefined()

      const major = Number(use.comment.match(/^v(\d+)/)?.[1])
      expect(major, `${where} comment "${use.comment}" does not start with a vN version`).not.toBeNaN()
      expect(
        major,
        `${where} is pinned to v${major}, which runs on the deprecated Node 20 runtime — v${floor} is the first Node 24 major`,
      ).toBeGreaterThanOrEqual(floor)
    }
  })

  it('covers the workflows that actually exist', async () => {
    const all = await uses()
    const files = new Set(all.map((u) => u.file))

    // Cheap canary: if a workflow file is renamed or the uses: regex stops
    // matching, the assertions above would pass vacuously on an empty list.
    expect(all.length).toBeGreaterThan(20)
    expect(files).toContain('ci.yml')
    expect(files).toContain('publish-image.yml')
    expect(files).toContain('security.yml')
  })
})

/**
 * The assertions above read the major from the `# vN` comment, which is written
 * by hand — a pin whose comment says `# v7` over a v4 SHA would satisfy them.
 * Closing that needs the network, so it is opt-in rather than part of the
 * default run:
 *
 *   VERIFY_ACTION_PINS=1 pnpm vitest run tests/unit/workflow-action-runtimes.test.ts
 *
 * Set GITHUB_TOKEN to lift the 60-requests-per-hour unauthenticated API limit.
 */
describe.runIf(process.env.VERIFY_ACTION_PINS)('workflow action pins resolve upstream', () => {
  async function tagSha(repo: string, tag: string): Promise<string> {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`

    const ref = await fetch(`https://api.github.com/repos/${repo}/git/ref/tags/${tag}`, { headers })
    expect(ref.ok, `${repo}@${tag} could not be resolved (HTTP ${ref.status})`).toBe(true)
    const { object } = (await ref.json()) as { object: { sha: string; type: string } }

    // Annotated tags point at a tag object, which points at the commit.
    if (object.type !== 'tag') return object.sha
    const deref = await fetch(`https://api.github.com/repos/${repo}/git/tags/${object.sha}`, { headers })
    expect(deref.ok, `${repo}@${tag} tag object could not be dereferenced`).toBe(true)
    return ((await deref.json()) as { object: { sha: string } }).object.sha
  }

  it('has every SHA matching the tag named in its comment', async () => {
    const external = (await uses()).filter((u) => !isLocal(u))
    expect(external.length).toBeGreaterThan(20)

    for (const use of external) {
      const tag = use.comment.match(/^(v\d+\.\d+\.\d+)/)?.[1]
      // Refs pinned to a branch rather than a release carry a different comment
      // form (trivy-action tracks master), and there is no tag to resolve.
      if (!tag) continue

      await expect(
        tagSha(use.ref, tag),
        `${use.file}:${use.line} (${use.ref}) comment claims ${tag} but the SHA is not that tag`,
      ).resolves.toBe(use.sha)
    }
  }, 60_000)
})
