import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The app (Docker image), @answerloops/agent-sdk and @answerloops/widget share
// one version number, so "v0.6.6" means the same thing on GitHub, in the image
// registry and on npm. A release bumps all three in one PR, then tags `v<n>`,
// `agent-sdk-v<n>` and `widget-v<n>`. This fails the PR that bumps only some.

const root = process.cwd()
const versionOf = (rel: string): string =>
  JSON.parse(readFileSync(path.join(root, rel), 'utf8')).version

describe('release versions stay aligned', () => {
  const app = versionOf('package.json')

  it('gives the app a plain semver version', () => {
    expect(app).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it.each(['packages/agent-sdk/package.json', 'packages/widget/package.json'])(
    '%s matches the app version',
    (rel) => {
      expect(versionOf(rel)).toBe(app)
    },
  )

  // The image itself is tagged from the git tag, so the only place a version is
  // written down for Docker is the pinned-image example in the ghcr compose file.
  it('shows the app version in the pinned-image example of the ghcr compose file', () => {
    const compose = readFileSync(path.join(root, 'docker-compose.ghcr.yml'), 'utf8')
    const pinned = compose.match(/ANSWERLOOPS_IMAGE=ghcr\.io\/answerloops\/answerloops:(\S+)/)
    expect(pinned, 'docker-compose.ghcr.yml has no pinned-image example').not.toBeNull()
    expect(pinned![1]).toBe(app)
  })
})
