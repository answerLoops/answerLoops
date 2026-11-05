import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the Snyk Container step in publish-image.yml.
 *
 * The repository is public, so `snyk container test` (which prints every
 * finding) must never run there; findings go to the private dashboard through
 * `snyk container monitor`. The step must also never block a release, must be
 * skipped without a token, and must scan the local candidate image before it is
 * pushed. Read as text, like the sibling workflow tests: no YAML parser is
 * available. Each guard is a pure function over the workflow text so the
 * mutation cases at the bottom can prove it fails on bad input.
 */

interface Step {
  name: string
  text: string
  /** Non-comment lines of the step. */
  lines: string[]
}

const stripComment = (l: string) => l.replace(/(^|\s)#.*$/, '').trimEnd()

function buildSteps(raw: string): Step[] {
  const all = raw.split('\n')
  const start = all.findIndex((l) => /^ {2}build:\s*$/.test(l))
  if (start === -1) throw new Error('build job missing')
  let end = all.length
  for (let i = start + 1; i < all.length; i++) {
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(all[i])) {
      end = i
      break
    }
  }
  const job = all.slice(start, end).map(stripComment)
  const steps: Step[] = []
  let cur: string[] | null = null
  for (const l of job) {
    if (/^ {6}- /.test(l)) {
      cur = [l]
      steps.push({ name: '', text: '', lines: cur })
    } else if (cur && l.trim() !== '') {
      cur.push(l)
    }
  }
  for (const s of steps) {
    s.text = s.lines.join('\n')
    s.name = /name:\s*(.+)/.exec(s.text)?.[1].trim() ?? ''
  }
  return steps
}

const index = (steps: Step[], pred: (s: Step) => boolean) => steps.findIndex(pred)
const isMonitor = (s: Step) => /snyk\s+container\s+monitor/.test(s.text)
const isTrivyVuln = (s: Step) => s.name === 'Refuse to publish known-vulnerable dependencies'
const isPush = (s: Step) => s.name === 'Build and push by digest'
const isTokenCheck = (s: Step) => /^\s*id:\s*snyk\s*$/m.test(s.text) || /^\s+- id:\s*snyk\s*$/m.test(s.text)

/** Any step whose script or action runs `snyk container test` (or `snyk test` on an image). */
const runsContainerTest = (steps: Step[]) => steps.some((s) => /snyk\s+container\s+test/.test(s.text))
const monitorContinuesOnError = (s: Step) => /^\s+continue-on-error:\s*true\s*$/m.test(s.text)
const gatedOnToken = (s: Step) => /^\s+if:\s*steps\.snyk\.outputs\.present == 'true'\s*$/m.test(s.text)

/** SNYK_TOKEN may only appear as `SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}` env entries. */
function tokenMisuse(steps: Step[]): string[] {
  const bad: string[] = []
  for (const s of steps) {
    const inRun = (() => {
      const out: string[] = []
      let collecting = false
      let runIndent = 0
      for (const l of s.lines) {
        const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l)
        if (m) {
          collecting = true
          runIndent = m[1].length
          out.push(m[2])
          continue
        }
        if (collecting) {
          const ind = l.length - l.trimStart().length
          if (ind > runIndent) out.push(l)
          else collecting = false
        }
      }
      return out
    })()
    for (const l of inRun) if (/secrets\.SNYK_TOKEN/.test(l)) bad.push(`run references secret: ${l.trim()}`)
    for (const l of s.lines) {
      if (!/SNYK_TOKEN/.test(l)) continue
      if (inRun.includes(l)) continue // $SNYK_TOKEN shell reads are covered above only for the secret expression
      if (/^\s+SNYK_TOKEN:\s*\$\{\{ secrets\.SNYK_TOKEN \}\}\s*$/.test(l)) continue
      bad.push(`unexpected SNYK_TOKEN use: ${l.trim()}`)
    }
  }
  return bad
}

async function load(): Promise<string> {
  return readFile(path.join(process.cwd(), '.github/workflows/publish-image.yml'), 'utf8')
}

describe('publish-image.yml: Snyk Container monitor', () => {
  it('has a monitor step in the build job with a per-platform project name and the Dockerfile', async () => {
    const steps = buildSteps(await load())
    const monitor = steps.find(isMonitor)
    expect(monitor, 'Snyk monitor step missing from build job').toBeDefined()
    const flat = monitor!.text.replace(/\s+/g, ' ')
    expect(flat).toContain('snyk container monitor "scan-candidate:${SUFFIX}"')
    expect(flat).toContain('--file=Dockerfile')
    expect(flat).toContain('--project-name="answerloops-image-${SUFFIX}"')
    expect(monitor!.text).toMatch(/^\s+SUFFIX:\s*\$\{\{ matrix\.suffix \}\}\s*$/m)
  })

  it('never runs snyk container test (it prints findings into public logs)', async () => {
    expect(runsContainerTest(buildSteps(await load()))).toBe(false)
    expect(await load()).not.toMatch(/^[^#\n]*snyk\s+container\s+test/m)
  })

  it('does not block a release: the monitor step is continue-on-error', async () => {
    const monitor = buildSteps(await load()).find(isMonitor)!
    expect(monitorContinuesOnError(monitor)).toBe(true)
  })

  it('gates every Snyk step after the token check on the token output', async () => {
    const steps = buildSteps(await load())
    const tokenIdx = index(steps, isTokenCheck)
    expect(tokenIdx).toBeGreaterThan(-1)
    const later = steps.slice(tokenIdx + 1).filter((s) => /snyk/i.test(s.text))
    expect(later.length).toBeGreaterThanOrEqual(2) // setup + monitor
    for (const s of later) expect(gatedOnToken(s), `step "${s.name}" is not gated on the token check`).toBe(true)
    // The token check itself must not be gated, or the output would be unset.
    expect(steps[tokenIdx].text).not.toMatch(/^\s+if:/m)
  })

  it('installs the Snyk CLI from a SHA-pinned action', async () => {
    const setup = buildSteps(await load()).find((s) => s.name === 'Install Snyk CLI')
    expect(setup).toBeDefined()
    expect(setup!.text).toMatch(/uses:\s*snyk\/actions\/setup@[0-9a-f]{40}\s*$/m)
  })

  it('runs the monitor after the Trivy vulnerability step and before the push', async () => {
    const steps = buildSteps(await load())
    const trivy = index(steps, isTrivyVuln)
    const monitor = index(steps, isMonitor)
    const push = index(steps, isPush)
    expect(trivy).toBeGreaterThan(-1)
    expect(monitor).toBeGreaterThan(trivy)
    expect(push).toBeGreaterThan(monitor)
  })

  it('references SNYK_TOKEN only as secrets.SNYK_TOKEN in env, never in run or as a literal', async () => {
    const steps = buildSteps(await load())
    expect(tokenMisuse(steps)).toEqual([])
    const raw = await load()
    expect(raw).not.toMatch(/SNYK_TOKEN:\s*(?!\$\{\{ secrets\.SNYK_TOKEN \}\})\S/)
  })
})

describe('guards fail on mutated workflow text', () => {
  const mutate = async (from: string | RegExp, to: string) => {
    const raw = await load()
    const out = raw.replace(from, to)
    expect(out, 'mutation did not change the workflow').not.toBe(raw)
    return buildSteps(out)
  }

  it('flags a re-added snyk container test step', async () => {
    const steps = await mutate('snyk container monitor "scan-candidate:${SUFFIX}"', 'snyk container test "scan-candidate:${SUFFIX}"')
    expect(runsContainerTest(steps)).toBe(true)
  })

  it('flags a monitor step that loses continue-on-error', async () => {
    const steps = await mutate(/(Snyk Container monitor\n\s+if:[^\n]*\n)\s+continue-on-error: true\n/, '$1')
    expect(monitorContinuesOnError(steps.find(isMonitor)!)).toBe(false)
  })

  it('flags a Snyk step that loses its token gate', async () => {
    const steps = await mutate("name: Install Snyk CLI\n        if: steps.snyk.outputs.present == 'true'\n", 'name: Install Snyk CLI\n')
    expect(gatedOnToken(steps.find((s) => s.name === 'Install Snyk CLI')!)).toBe(false)
  })

  it('flags the monitor moving after the push', async () => {
    const raw = await load()
    const a = raw.indexOf('      - name: Snyk Container monitor')
    const b = raw.indexOf('      # Pushed by digest')
    const c = raw.indexOf('      # Passed through env')
    const moved = raw.slice(0, a) + raw.slice(b, c) + raw.slice(a, b) + raw.slice(c)
    const steps = buildSteps(moved)
    expect(index(steps, isMonitor)).toBeGreaterThan(index(steps, isPush))
  })

  it('flags the token interpolated into a run script', async () => {
    const steps = await mutate('snyk container monitor "scan-candidate:${SUFFIX}"', 'snyk auth ${{ secrets.SNYK_TOKEN }} && snyk container monitor "scan-candidate:${SUFFIX}"')
    expect(tokenMisuse(steps).length).toBeGreaterThan(0)
  })

  it('flags a literal token value', async () => {
    const steps = await mutate(/(Snyk Container monitor[\s\S]*?)SNYK_TOKEN: \$\{\{ secrets\.SNYK_TOKEN \}\}/, '$1SNYK_TOKEN: <literal-value>')
    expect(tokenMisuse(steps).length).toBeGreaterThan(0)
  })
})
