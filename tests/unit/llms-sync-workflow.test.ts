import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

describe('llms.txt CI synchronization', () => {
  it('checks freshness in CI and permits the main-branch sync workflow to commit only llms.txt', async () => {
    const root = process.cwd()
    const [ci, sync] = await Promise.all([
      readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
      readFile(path.join(root, '.github/workflows/sync-llms-txt.yml'), 'utf8'),
    ])

    expect(ci).toContain('node scripts/sync-llms-txt.mjs --check')
    // Deny by default at the workflow level; only the sync job may write, and only contents.
    expect(sync).toMatch(/^permissions: \{\}$/m)
    expect(sync).toContain('permissions:\n      contents: write')
    expect(sync).not.toMatch(/^permissions:\n  contents: write/m)
    expect(sync).toContain('persist-credentials: false')
    expect(sync).toContain('gh auth setup-git')
    expect(sync).toContain('git add public/llms.txt')
    expect(sync).toContain('git push')
    expect(sync).not.toContain('git add -A')
  })
})
