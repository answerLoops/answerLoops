import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Guards the e2e job's Playwright OS dependency install. It shells out to apt
 * on the runner, and a transient DNS failure there used to burn ~11 minutes in
 * apt's own retries and then fail the whole job, with a manual rerun as the only
 * recovery. These checks keep the bounded, retried install from regressing.
 */
describe('e2e job Playwright dependency install', () => {
  async function steps(): Promise<string> {
    const ci = await readFile(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    const start = ci.indexOf('- name: Configure apt for flaky networks')
    expect(start, 'apt resilience step is missing from ci.yml').toBeGreaterThan(-1)
    const end = ci.indexOf('- name: Create test database', start)
    expect(end, 'Create test database step not found after the install steps').toBeGreaterThan(start)
    return ci.slice(start, end)
  }

  it('configures apt to fail fast on stalled fetches and retry them', async () => {
    const block = await steps()

    expect(block).toContain('Acquire::Retries')
    expect(block).toContain('Acquire::http::Timeout')
    expect(block).toContain('Acquire::https::Timeout')
  })

  it('retries both install paths and bounds each with a step timeout', async () => {
    const block = await steps()

    for (const command of [
      'pnpm exec playwright install --with-deps chromium',
      'pnpm exec playwright install-deps chromium',
    ]) {
      const at = block.indexOf(command)
      expect(at, `${command} is missing`).toBeGreaterThan(-1)
      // The command must sit inside a retry loop that eventually fails the step.
      const stepStart = block.lastIndexOf('- name:', at)
      const stepText = block.slice(stepStart, block.indexOf('- name:', at) === -1 ? undefined : block.indexOf('- name:', at))
      expect(stepText).toContain('for attempt in 1 2 3')
      expect(stepText).toContain('&& exit 0')
      expect(stepText).toContain('exit 1')
      expect(stepText).toContain('timeout-minutes:')
    }
  })

  it('configures apt before either install runs', async () => {
    const block = await steps()

    const configure = block.indexOf('Acquire::Retries')
    expect(configure).toBeGreaterThan(-1)
    expect(configure).toBeLessThan(block.indexOf('playwright install --with-deps'))
    expect(configure).toBeLessThan(block.indexOf('playwright install-deps'))
  })
})
