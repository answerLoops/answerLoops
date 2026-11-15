import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the e2e job's Playwright OS dependency install. It shells out to apt
 * on the runner, and a sustained mirror outage used to burn ~11 minutes in
 * apt's own retries and then fail the whole job even though Chromium itself
 * could launch. These checks keep the bounded install plus launch verification
 * from regressing.
 */
describe('e2e job Playwright dependency install', () => {
  async function step(name: string): Promise<string> {
    const ci = await readFile(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    const start = ci.indexOf(`- name: ${name}`)
    expect(start, `"${name}" step is missing from ci.yml`).toBeGreaterThan(-1)
    const next = ci.indexOf('\n      - ', start + 1)
    return next === -1 ? ci.slice(start) : ci.slice(start, next)
  }

  it('downloads the browser without apt, only on a cache miss', async () => {
    const block = await step('Install Playwright browsers')

    expect(block).toContain("cache-hit != 'true'")
    expect(block).toContain('pnpm exec playwright install chromium')
    expect(block).not.toContain('--with-deps')
  })

  it('installs OS dependencies on every run, bounded in time and attempts', async () => {
    const block = await step('Install Playwright OS dependencies')

    expect(block).not.toContain('if:')
    expect(block).toContain('timeout-minutes:')
    expect(block).toContain('timeout 180 pnpm exec playwright install-deps chromium')
    expect(block).toContain('for attempt in 1 2')
    expect(block).toContain('Acquire::http::Timeout')
    expect(block).toContain('Acquire::https::Timeout')
  })

  it('tolerates a failed install only if Chromium really launches', async () => {
    const block = await step('Install Playwright OS dependencies')

    const install = block.indexOf('install-deps chromium')
    const launch = block.indexOf('chromium.launch()')
    expect(launch, 'launch check is missing').toBeGreaterThan(install)
    // The launch check is what decides pass/fail, so it must be able to fail the step.
    expect(block).toContain('process.exit(1)')
    // The install loop itself must not be allowed to fail the step on its own.
    expect(block).toContain('::warning::')
  })
})
