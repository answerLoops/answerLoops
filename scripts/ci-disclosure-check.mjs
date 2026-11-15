#!/usr/bin/env node
/**
 * CI disclosure check — the layer that cannot be bypassed locally.
 *
 * The pre-commit hook and the gh PreToolUse hook both run on the machine
 * writing the change, which means both can be skipped by whoever is writing it:
 * `--no-verify`, a `disclosure-ok` marker, or simply editing the hook. That is
 * acceptable for a human making a considered exception. It is not a control.
 *
 * This runs on GitHub, on the pull request itself, and covers the three things
 * the local hooks miss:
 *
 *   1. Commits pushed with --no-verify, or from a machine with no hooks installed
 *   2. A PR title or body written in the web UI, which never touches this repo
 *   3. A PR body edited *after* it was created — hence the `edited` trigger
 *
 * Scope note: it scans the PR's added lines rather than whole files, so
 * pre-existing wording in untouched files does not fail unrelated PRs. Full
 * history is a separate, periodic sweep, not a per-PR gate.
 *
 * The title and body arrive through the environment rather than through
 * workflow interpolation. Interpolating a PR body directly into a shell step
 * would let the body itself alter the command being run, which is a poor
 * trade for a check whose entire job is handling untrusted-ish text.
 */

import { execSync } from 'node:child_process'
import { scanText, match, EXEMPT_FILES, ALLOW_MARKER } from './check-disclosure.mjs'
import { shouldScanPrBody } from './disclosure-body-policy.mjs'

const base = process.env.BASE_SHA
const head = process.env.HEAD_SHA

function addedLines() {
  if (!base || !head) return []

  const diff = execSync(`git diff --unified=0 --no-color ${base}...${head}`, {
    encoding: 'utf-8',
    maxBuffer: 128 * 1024 * 1024,
  })

  const out = []
  let file = null
  let lineNo = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6)
      continue
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/)
      lineNo = m ? Number(m[1]) : 0
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const text = raw.slice(1)
      if (file && !EXEMPT_FILES.includes(file) && !text.includes(ALLOW_MARKER)) {
        const hit = match(text)
        if (hit) out.push({ where: `${file}:${lineNo}`, text: text.trim(), hit })
      }
      lineNo++
    }
  }
  return out
}

// A Dependabot PR body is the upstream project's release notes, copied
// verbatim. See scripts/disclosure-body-policy.mjs for why that one case is
// exempt and why the title and added lines never are.
const scanBody = shouldScanPrBody({
  author: process.env.PR_AUTHOR,
  authorType: process.env.PR_AUTHOR_TYPE,
  action: process.env.PR_ACTION,
  actor: process.env.PR_ACTOR,
})
if (!scanBody) {
  console.log('PR body not scanned: it is generated release-note text on a Dependabot PR.')
}

const findings = [
  // No marker escape hatch on these two: they are public the moment the PR is
  // opened, and GitHub keeps their edit history, so there is nothing to walk back.
  ...scanText(process.env.PR_TITLE, 'PR title', { honorMarker: false }),
  ...(scanBody ? scanText(process.env.PR_BODY, 'PR body', { honorMarker: false }) : []),
  ...addedLines(),
]

if (findings.length === 0) {
  console.log('Disclosure check passed — PR title, body and added lines are clean.')
  process.exit(0)
}

console.error('')
console.error('DISCLOSURE CHECK FAILED')
console.error('')
console.error('These lines describe a weakness rather than what the code guarantees.')
console.error('A public surface may say a security issue was fixed and nothing more.')
console.error('')

for (const f of findings) {
  console.error(`  ${f.where}`)
  console.error(`    ${f.text.slice(0, 160)}`)
  console.error(`    matched: ${f.hit.re}${f.hit.with ? ` + ${f.hit.with}` : ''}`)
  console.error('')
}

console.error('What to do:')
console.error('  Reword to state the invariant — what the code now guarantees — and move the')
console.error('  mechanism to the internal security page.')
console.error('')
console.error(`  A line that genuinely needs the wording can carry ${JSON.stringify(ALLOW_MARKER)}.`)
console.error('  That marker does not apply to the PR title or body, which are public by')
console.error('  definition — reword those instead.')
console.error('')

// Annotate the PR directly when running in Actions, so the finding shows up on
// the Files tab rather than only in the job log.
if (process.env.GITHUB_ACTIONS) {
  for (const f of findings) {
    const [file, line] = f.where.split(':')
    if (file.startsWith('PR ')) continue
    console.log(`::error file=${file},line=${line || 1}::Disclosure check: ${f.text.slice(0, 120)}`)
  }
}

process.exit(1)
