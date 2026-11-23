import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The README pulls badge reads a gist this workflow keeps current. These checks
 * keep it from publishing a wrong number or gaining permissions it doesn't need.
 */
describe('container pulls badge workflow', () => {
  async function workflow(): Promise<string> {
    return readFile(path.join(process.cwd(), '.github/workflows/container-pulls-badge.yml'), 'utf8')
  }

  it('runs on a schedule and can be started by hand', async () => {
    const yml = await workflow()
    expect(yml).toContain('schedule:')
    expect(yml).toContain('workflow_dispatch')
  })

  it('fails instead of publishing when the count cannot be read', async () => {
    const yml = await workflow()
    expect(yml).toContain('set -euo pipefail')
    expect(yml).toContain('[ -n "$count" ]')
    expect(yml).toContain('exit 1')
  })

  it('holds no repository permissions and keeps the gist token in a secret', async () => {
    const yml = await workflow()
    expect(yml).toMatch(/^permissions: \{\}$/m)
    expect(yml).toContain('secrets.PULLS_GIST_TOKEN')
    expect(yml).not.toMatch(/uses:/)
    expect(yml).toContain('environment: container-pulls-badge')
  })
})
