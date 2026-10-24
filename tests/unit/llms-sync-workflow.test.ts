import { describe, expect, it } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

describe('llms.txt CI synchronization', () => {
  it('checks llms.txt in CI and has no workflow that pushes to main', async () => {
    const root = process.cwd()
    const ci = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8')

    expect(ci).toContain('node scripts/sync-llms-txt.mjs --check')
    // main is protected (pull request + required checks, enforced on admins), so a
    // bot push could never land. Drift is stopped at pull-request time instead.
    await expect(access(path.join(root, '.github/workflows/sync-llms-txt.yml'))).rejects.toThrow()
  })

  it('exposes the sync and check commands as package scripts', async () => {
    const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts['llms:sync']).toBe('node scripts/sync-llms-txt.mjs')
    expect(pkg.scripts['llms:check']).toBe('node scripts/sync-llms-txt.mjs --check')
  })
})
