import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the `snyk` job in security.yml.
 *
 * The repository is public, so `snyk test` output (every finding) must not
 * reach the job log: stdout is discarded and the exit code still gates the
 * job. Findings are uploaded to the private dashboard by `snyk monitor`
 * instead. Read as text, like the sibling workflow tests. Each guard is a pure
 * function over the workflow text so the mutation cases at the bottom can prove
 * it fails on bad input.
 */

interface Step {
  name: string
  text: string
  lines: string[]
}

const stripComment = (l: string) => l.replace(/(^|\s)#.*$/, '').trimEnd()

function snykJob(raw: string): string[] {
  const all = raw.split('\n')
  const start = all.findIndex((l) => /^ {2}snyk:\s*$/.test(l))
  if (start === -1) throw new Error('snyk job missing')
  let end = all.length
  for (let i = start + 1; i < all.length; i++) {
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(all[i])) {
      end = i
      break
    }
  }
  return all.slice(start, end).map(stripComment)
}

function steps(raw: string): Step[] {
  const out: Step[] = []
  let cur: string[] | null = null
  for (const l of snykJob(raw)) {
    if (/^ {6}- /.test(l)) {
      cur = [l]
      out.push({ name: '', text: '', lines: cur })
    } else if (cur && l.trim() !== '') {
      cur.push(l)
    }
  }
  for (const s of out) {
    s.text = s.lines.join('\n')
    s.name = /name:\s*(.+)/.exec(s.text)?.[1].trim() ?? ''
  }
  return out
}

const isMonitor = (s: Step) => /snyk\s+monitor\b/.test(s.text)
const isTest = (s: Step) => /snyk\s+test\b/.test(s.text)
const snykCommandLine = (s: Step) => s.lines.find((l) => /snyk\s+test\b/.test(l)) ?? ''

/** stdout of `snyk test` is discarded and no machine-readable output flag is used. */
const withholdsOutput = (s: Step) => {
  const cmd = snykCommandLine(s)
  return /\s>\s*\/dev\/null\s*$/.test(cmd) && !/--(json|sarif|json-file-output|sarif-file-output)\b/.test(s.text)
}
const propagatesExit = (s: Step) => /^\s*exit "\$code"\s*$/m.test(s.text) && /^\s*code=\$\?\s*$/m.test(s.text)
const skippedOnPr = (s: Step) => /^\s+if:.*github\.event_name != 'pull_request'/m.test(s.text)
const continuesOnError = (s: Step) => /^\s+continue-on-error:\s*true\s*$/m.test(s.text)

function tokenMisuse(list: Step[]): string[] {
  const bad: string[] = []
  for (const s of list) {
    const runBody: string[] = []
    let collecting = false
    let runIndent = 0
    for (const l of s.lines) {
      const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l)
      if (m) {
        collecting = true
        runIndent = m[1].length
        runBody.push(m[2])
        continue
      }
      if (collecting) {
        if (l.length - l.trimStart().length > runIndent) runBody.push(l)
        else collecting = false
      }
    }
    for (const l of runBody) if (/secrets\.SNYK_TOKEN/.test(l)) bad.push(`run references secret: ${l.trim()}`)
    for (const l of s.lines) {
      if (!/SNYK_TOKEN/.test(l) || runBody.includes(l)) continue
      if (/^\s+SNYK_TOKEN:\s*\$\{\{ secrets\.SNYK_TOKEN \}\}\s*$/.test(l)) continue
      bad.push(`unexpected SNYK_TOKEN use: ${l.trim()}`)
    }
  }
  return bad
}

async function load(): Promise<string> {
  return readFile(path.join(process.cwd(), '.github/workflows/security.yml'), 'utf8')
}

describe('security.yml: snyk job', () => {
  it('discards snyk test stdout and never emits machine-readable output', async () => {
    const test = steps(await load()).find(isTest)
    expect(test, 'snyk test step missing').toBeDefined()
    expect(withholdsOutput(test!)).toBe(true)
  })

  it('gates on high severity with an available fix and propagates the exit code', async () => {
    const test = steps(await load()).find(isTest)!
    expect(test.text).toContain('--severity-threshold=high')
    expect(test.text).toContain('--fail-on=upgradable')
    expect(propagatesExit(test)).toBe(true)
  })

  it('excludes security-tools from both monitor and test', async () => {
    const list = steps(await load())
    expect(snykCommandOf(list.find(isMonitor)!)).toContain('--exclude=security-tools')
    expect(snykCommandOf(list.find(isTest)!)).toContain('--exclude=security-tools')
    expect(list.find(isMonitor)!.text).toContain('--all-projects')
    expect(list.find(isTest)!.text).toContain('--all-projects')
  })

  it('skips the monitor on pull_request and never lets it fail the job', async () => {
    const monitor = steps(await load()).find(isMonitor)
    expect(monitor, 'snyk monitor step missing').toBeDefined()
    expect(skippedOnPr(monitor!)).toBe(true)
    expect(continuesOnError(monitor!)).toBe(true)
  })

  it('runs the monitor before the test so findings upload even when the gate fails', async () => {
    const list = steps(await load())
    const m = list.findIndex(isMonitor)
    const t = list.findIndex(isTest)
    expect(m).toBeGreaterThan(-1)
    expect(t).toBeGreaterThan(m)
  })

  it('declares only contents: read', async () => {
    const job = snykJob(await load())
    const i = job.findIndex((l) => /^ {4}permissions:\s*$/.test(l))
    expect(i).toBeGreaterThan(-1)
    const scopes: string[] = []
    for (let j = i + 1; j < job.length && /^ {6}\S/.test(job[j]); j++) scopes.push(job[j].trim())
    expect(scopes).toEqual(['contents: read'])
  })

  it('references SNYK_TOKEN only as secrets.SNYK_TOKEN in env, never in run or as a literal', async () => {
    expect(tokenMisuse(steps(await load()))).toEqual([])
  })
})

function snykCommandOf(s: Step): string {
  return s.lines.find((l) => /snyk\s+(monitor|test)\b/.test(l)) ?? ''
}

describe('guards fail on mutated workflow text', () => {
  const mutate = async (from: string | RegExp, to: string) => {
    const raw = await load()
    const out = raw.replace(from, to)
    expect(out, 'mutation did not change the workflow').not.toBe(raw)
    return steps(out)
  }

  it('flags a removed stdout redirect', async () => {
    const list = await mutate(' --fail-on=upgradable > /dev/null', ' --fail-on=upgradable')
    expect(withholdsOutput(list.find(isTest)!)).toBe(false)
  })

  it('flags a --json flag', async () => {
    const list = await mutate(' --fail-on=upgradable > /dev/null', ' --fail-on=upgradable --json > /dev/null')
    expect(withholdsOutput(list.find(isTest)!)).toBe(false)
  })

  it('flags a --sarif flag', async () => {
    const list = await mutate(' --fail-on=upgradable > /dev/null', ' --fail-on=upgradable --sarif > /dev/null')
    expect(withholdsOutput(list.find(isTest)!)).toBe(false)
  })

  it('flags a swallowed exit code', async () => {
    const list = await mutate('exit "$code"', 'exit 0')
    expect(propagatesExit(list.find(isTest)!)).toBe(false)
  })

  it('flags a monitor that runs on pull requests', async () => {
    const list = await mutate(" && github.event_name != 'pull_request'", '')
    expect(skippedOnPr(list.find(isMonitor)!)).toBe(false)
  })

  it('flags a monitor that can fail the job', async () => {
    const list = await mutate(/(Snyk monitor \(private dashboard\)\n\s+if:[^\n]*\n)\s+continue-on-error: true\n/, '$1')
    expect(continuesOnError(list.find(isMonitor)!)).toBe(false)
  })

  it('flags the token interpolated into a run script', async () => {
    const list = await mutate('run: snyk monitor --all-projects', 'run: snyk auth ${{ secrets.SNYK_TOKEN }} && snyk monitor --all-projects')
    expect(tokenMisuse(list).length).toBeGreaterThan(0)
  })
})
