import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the least-privilege posture of every GitHub Actions workflow.
 *
 * Nothing goes red when someone deletes a `permissions: {}` line, adds a
 * `write` scope to the wrong job, or re-tags the e2e database image — the
 * workflows keep passing, just with a wider blast radius. These tests pin the
 * hardened shape instead.
 *
 * No YAML parser is importable from the test environment, so — like the
 * sibling workflow tests — this reads the files as text. The workflows here use
 * a regular two-space block layout, which the small indentation-based reader
 * below relies on.
 */

/** The only places a `write` scope is allowed, and exactly which scope. */
const WRITE_ALLOWLIST: Record<string, Record<string, string[]>> = {
  'publish-image.yml': { build: ['packages'], merge: ['packages'] },
  'publish-agent-sdk.yml': { publish: ['id-token'] },
  'sync-llms-txt.yml': { sync: ['contents'] },
}

interface Line {
  /** 1-based line number in the file. */
  n: number
  indent: number
  /** Comment-stripped, trimmed text. */
  text: string
}

interface Workflow {
  file: string
  lines: Line[]
}

const dir = () => path.join(process.cwd(), '.github/workflows')

function stripComment(raw: string): string {
  // Full-line comments and trailing ` # ...` comments. None of the workflows
  // put a `#` inside a quoted scalar on the lines these tests look at.
  return raw.replace(/(^|\s)#.*$/, '').trimEnd()
}

async function workflows(): Promise<Workflow[]> {
  const files = (await readdir(dir())).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort()
  const out: Workflow[] = []
  for (const file of files) {
    const raw = (await readFile(path.join(dir(), file), 'utf8')).split('\n')
    const lines: Line[] = []
    raw.forEach((r, i) => {
      const stripped = stripComment(r)
      if (stripped.trim() === '') return
      lines.push({ n: i + 1, indent: stripped.length - stripped.trimStart().length, text: stripped.trim() })
    })
    out.push({ file, lines })
  }
  return out
}

/** Lines that belong to the block opened by `lines[start]` (deeper indent). */
function childrenOf(lines: Line[], start: number): Line[] {
  const base = lines[start].indent
  const kids: Line[] = []
  for (let i = start + 1; i < lines.length && lines[i].indent > base; i++) kids.push(lines[i])
  return kids
}

function topLevel(wf: Workflow, key: string): { index: number; inline: string; body: Line[] } | null {
  const index = wf.lines.findIndex((l) => l.indent === 0 && (l.text === `${key}:` || l.text.startsWith(`${key}: `)))
  if (index === -1) return null
  return {
    index,
    inline: wf.lines[index].text.slice(key.length + 1).trim(),
    body: childrenOf(wf.lines, index),
  }
}

interface Job {
  name: string
  lines: Line[]
}

function jobsOf(wf: Workflow): Job[] {
  const jobs = topLevel(wf, 'jobs')
  if (!jobs) return []
  const jobIndent = jobs.body[0].indent
  const result: Job[] = []
  jobs.body.forEach((line, i) => {
    if (line.indent !== jobIndent || !line.text.endsWith(':')) return
    const lines: Line[] = []
    for (let j = i + 1; j < jobs.body.length && jobs.body[j].indent > jobIndent; j++) lines.push(jobs.body[j])
    result.push({ name: line.text.slice(0, -1), lines })
  })
  return result
}

/** Parses a `permissions` declaration into scope -> level. `null` when absent. */
function parsePermissions(block: { inline: string; body: Line[] } | null): Record<string, string> | null {
  if (!block) return null
  if (block.inline === '{}') return {}
  if (block.inline === 'write-all' || block.inline === 'read-all') return { '*': block.inline }
  const scopes: Record<string, string> = {}
  for (const l of block.body) {
    const m = l.text.match(/^([\w-]+):\s*(\S+)$/)
    if (m) scopes[m[1]] = m[2]
  }
  return scopes
}

function jobPermissions(job: Job): Record<string, string> | null {
  const idx = job.lines.findIndex((l) => l.indent === job.lines[0].indent && /^permissions:(\s|$)/.test(l.text))
  if (idx === -1) return null
  return parsePermissions({
    inline: job.lines[idx].text.slice('permissions:'.length).trim(),
    body: childrenOf(job.lines, idx),
  })
}

const isWrite = (level: string) => level === 'write' || level === 'write-all'

describe('workflow least privilege', () => {
  it('finds the workflows it is supposed to guard', async () => {
    const wfs = await workflows()
    // Canary: an empty or shrunken list would make every assertion below pass vacuously.
    expect(wfs.map((w) => w.file)).toEqual(
      expect.arrayContaining([
        'ci.yml',
        'disclosure.yml',
        'keep-alive.yml',
        'publish-agent-sdk.yml',
        'publish-image.yml',
        'security.yml',
        'sync-llms-txt.yml',
      ]),
    )
    for (const wf of wfs) expect(jobsOf(wf).length, `${wf.file} has no parseable jobs`).toBeGreaterThan(0)
  })

  it('declares a top-level permissions key in every workflow that grants no write scope', async () => {
    for (const wf of await workflows()) {
      const perms = parsePermissions(topLevel(wf, 'permissions'))
      expect(perms, `${wf.file} has no top-level permissions: key (default token scope is too wide)`).not.toBeNull()
      for (const [scope, level] of Object.entries(perms!)) {
        expect(
          isWrite(level),
          `${wf.file} grants ${scope}: ${level} at workflow level — write scopes belong on the single job that needs them`,
        ).toBe(false)
      }
    }
  })

  it('declares an explicit permissions block on every job', async () => {
    for (const wf of await workflows()) {
      for (const job of jobsOf(wf)) {
        expect(
          jobPermissions(job),
          `${wf.file} job "${job.name}" has no permissions: block — it would inherit the workflow default`,
        ).not.toBeNull()
      }
    }
  })

  it('allows write scopes only on the allowlisted jobs', async () => {
    for (const wf of await workflows()) {
      const allowed = WRITE_ALLOWLIST[wf.file] ?? {}
      const seenJobs = new Set<string>()

      for (const job of jobsOf(wf)) {
        const perms = jobPermissions(job) ?? {}
        const writes = Object.entries(perms)
          .filter(([, level]) => isWrite(level))
          .map(([scope]) => scope)
          .sort()
        const expected = [...(allowed[job.name] ?? [])].sort()
        if (expected.length) seenJobs.add(job.name)
        expect(
          writes,
          `${wf.file} job "${job.name}" holds write scopes [${writes.join(', ')}] but the allowlist permits [${expected.join(', ')}]`,
        ).toEqual(expected)
      }

      // Every allowlisted job must still exist and still hold its scope, so a
      // rename cannot silently turn the allowlist into dead entries.
      for (const jobName of Object.keys(allowed)) {
        expect(seenJobs.has(jobName), `${wf.file} no longer has allowlisted job "${jobName}"`).toBe(true)
      }
    }
  })

  it('has no write scope anywhere outside a parsed permissions block', async () => {
    for (const wf of await workflows()) {
      const jobs = jobsOf(wf)
      const allowed = WRITE_ALLOWLIST[wf.file] ?? {}
      const jobOfLine = (n: number) => jobs.find((j) => j.lines.some((l) => l.n === n))?.name
      for (const l of wf.lines) {
        if (!/(^|[\s{,])[\w-]+:\s*write(-all)?\s*[,}]?$/.test(l.text) && !/^permissions:\s*write-all/.test(l.text)) continue
        const job = jobOfLine(l.n)
        const scope = l.text.match(/^([\w-]+):/)?.[1]
        expect(
          job !== undefined && allowed[job]?.includes(scope ?? ''),
          `${wf.file}:${l.n} (${job ? `job "${job}"` : 'workflow level'}) contains "${l.text}", which is not on the write allowlist`,
        ).toBe(true)
      }
    }
  })

  it('never triggers on pull_request_target or workflow_run', async () => {
    for (const wf of await workflows()) {
      for (const l of wf.lines) {
        expect(
          /\b(pull_request_target|workflow_run)\b/.test(l.text),
          `${wf.file}:${l.n} uses a privileged-context trigger ("${l.text}")`,
        ).toBe(false)
      }
    }
  })

  it('pins every container image in ci.yml by sha256 digest', async () => {
    const ci = (await workflows()).find((w) => w.file === 'ci.yml')!
    const images: Line[] = []
    ci.lines.forEach((l) => {
      const image = l.text.match(/^image:\s*(\S+)$/)
      const container = l.text.match(/^container:\s*(\S+)$/)
      if (image || container) images.push(l)
      // A `container:` mapping carries its image on an `image:` child, collected above.
    })
    expect(images.length, 'ci.yml has no image:/container: entries — the digest check would be vacuous').toBeGreaterThan(0)
    for (const l of images) {
      expect(
        l.text,
        `ci.yml:${l.n} "${l.text}" is not pinned by digest (expected <image>:<tag>@sha256:<64 hex>)`,
      ).toMatch(/@sha256:[a-f0-9]{64}$/)
    }
    // And specifically the e2e database, the one that was floating before.
    expect(images.some((l) => /pgvector\/pgvector:pg16@sha256:[a-f0-9]{64}$/.test(l.text))).toBe(true)
  })

  it('runs the zizmor audit with a read-only token, auditor persona and a medium floor', async () => {
    const sec = (await workflows()).find((w) => w.file === 'security.yml')!
    const zizmor = jobsOf(sec).find((j) => j.name === 'zizmor')
    expect(zizmor, 'security.yml has no zizmor job').toBeDefined()

    expect(jobPermissions(zizmor!), 'security.yml zizmor job must be limited to contents: read').toEqual({
      contents: 'read',
    })

    const runIdx = zizmor!.lines.findIndex((l) => /^run:\s*zizmor\b/.test(l.text))
    expect(runIdx, 'security.yml zizmor job has no `run: zizmor ...` step').toBeGreaterThan(-1)
    const run = zizmor!.lines[runIdx].text
    expect(run).toMatch(/--persona auditor\b/)
    expect(run).toMatch(/--min-severity medium\b/)

    // The env block sits in the same step as the run line: same indent, before it.
    const stepLines = zizmor!.lines.filter((l) => l.indent === zizmor!.lines[runIdx].indent)
    expect(
      stepLines.some((l) => l.text === 'env:'),
      'security.yml zizmor step has no env: block',
    ).toBe(true)
    expect(
      zizmor!.lines.some((l) => l.text === 'GH_TOKEN: ${{ github.token }}'),
      'security.yml zizmor step must pass GH_TOKEN: ${{ github.token }} so the online audits run',
    ).toBe(true)
  })

  it.each(['publish-agent-sdk.yml', 'keep-alive.yml'])(
    'serialises %s with a concurrency group that never cancels a run in progress',
    async (file) => {
      const wf = (await workflows()).find((w) => w.file === file)!
      const block = topLevel(wf, 'concurrency')
      expect(block, `${file} has no top-level concurrency: block`).not.toBeNull()
      expect(
        block!.body.some((l) => /^group:\s*\S+/.test(l.text)),
        `${file} concurrency block has no group:`,
      ).toBe(true)
      expect(
        block!.body.some((l) => l.text === 'cancel-in-progress: false'),
        `${file} concurrency must set cancel-in-progress: false`,
      ).toBe(true)
    },
  )

  it('disables credential persistence on every actions/checkout step', async () => {
    let checkouts = 0
    for (const wf of await workflows()) {
      wf.lines.forEach((l, i) => {
        if (!/^(-\s+)?uses:\s*actions\/checkout@/.test(l.text)) return
        checkouts++
        // The step's `with:` block is the sibling content that follows the uses line,
        // up to the next step (a `- ` line at or above the step's indent).
        const stepIndent = l.text.startsWith('-') ? l.indent : l.indent - 2
        const following: Line[] = []
        for (let j = i + 1; j < wf.lines.length; j++) {
          const next = wf.lines[j]
          if (next.indent <= stepIndent) break
          following.push(next)
        }
        expect(
          following.some((f) => f.text === 'persist-credentials: false'),
          `${wf.file}:${l.n} actions/checkout does not set persist-credentials: false`,
        ).toBe(true)
      })
    }
    expect(checkouts, 'no actions/checkout steps found — the check would be vacuous').toBeGreaterThan(5)
  })
})
