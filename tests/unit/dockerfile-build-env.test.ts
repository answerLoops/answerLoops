import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// next.config.ts bakes the CSP in at build time, so a flag it reads must be
// visible to `pnpm build`. Docker only passes build variables that are declared.

const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf-8')
const buildStage = dockerfile.split(/^FROM /m).find((s) => s.startsWith('deps AS build'))!

describe('Dockerfile build stage', () => {
  it('declares CLOUDFLARE_WEB_ANALYTICS before pnpm build', () => {
    const arg = buildStage.indexOf('ARG CLOUDFLARE_WEB_ANALYTICS')
    const env = buildStage.indexOf('ENV CLOUDFLARE_WEB_ANALYTICS=$CLOUDFLARE_WEB_ANALYTICS')
    const build = buildStage.indexOf('RUN pnpm build')
    expect(arg).toBeGreaterThan(-1)
    expect(env).toBeGreaterThan(arg)
    expect(build).toBeGreaterThan(env)
  })

  it('every build-time flag next.config.ts reads is declared as an ARG', () => {
    const config = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf-8')
    const flags = [...config.matchAll(/process\.env\.(CLOUDFLARE_WEB_ANALYTICS)\b/g)].map((m) => m[1])
    for (const f of new Set(flags)) expect(buildStage).toContain(`ARG ${f}`)
  })
})
