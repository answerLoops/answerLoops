import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The production image ships only runtime output: the Next.js standalone
// server and the bundled bot. These checks keep the runner from drifting back
// to copying the whole build stage, and keep `pnpm start` / `pnpm bot:start`
// (used by Railway and every compose file) pointing at real files.

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

const dockerfile = read('Dockerfile')
const runner = dockerfile.slice(dockerfile.indexOf('AS runner'))
const buildStage = dockerfile.split(/^FROM /m).find((s) => s.startsWith('deps AS build'))!
const runtimePkg = JSON.parse(read('docker/runtime.package.json')) as {
  scripts: Record<string, string>
}
const rootPkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

describe('Dockerfile runner: ships runtime output only', () => {
  it('never copies the whole build stage', () => {
    expect(runner).not.toMatch(/COPY [^\n]*--from=build \/app \.\/?\s*$/m)
  })

  it('copies the standalone server, static assets, public and migrations', () => {
    for (const src of ['.next/standalone', '.next/static', 'public', 'drizzle', 'lib/marketing/fonts']) {
      expect(runner).toContain(`--from=build /app/${src} `)
    }
  })

  it('build stage turns on standalone output before pnpm build and bundles the bot after', () => {
    const env = buildStage.indexOf('ENV NEXT_OUTPUT_STANDALONE=1')
    const build = buildStage.indexOf('RUN pnpm build')
    const bot = buildStage.indexOf('RUN pnpm bot:build')
    expect(env).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(env)
    expect(bot).toBeGreaterThan(build)
  })

  it('next.config.ts gates standalone output on the variable the build stage sets', () => {
    expect(read('next.config.ts')).toContain("process.env.NEXT_OUTPUT_STANDALONE === '1'")
  })

  it('the server listens on every interface, not the container hostname', () => {
    expect(runner).toContain('ENV HOSTNAME=0.0.0.0')
  })

  it('pnpm does not try to reinstall dependencies before running a script', () => {
    expect(runner).toContain('ENV pnpm_config_verify_deps_before_run=false')
  })
})

describe('runtime package.json: start commands resolve to shipped files', () => {
  it('is copied in as the image package.json', () => {
    expect(runner).toContain('/app/docker/runtime.package.json ./package.json')
  })

  it('start runs the standalone server', () => {
    expect(runtimePkg.scripts.start).toBe('node server.js')
  })

  it('bot:start runs the bundle the build stage produces and the runner copies', () => {
    const out = rootPkg.scripts['bot:build'].match(/--outfile=(\S+)/)?.[1]
    expect(out).toBe('dist/bot.cjs')
    expect(runner).toContain(`--from=build /app/${out} ./bot.cjs`)
    expect(runtimePkg.scripts['bot:start']).toBe('node bot.cjs')
  })

  it('declares exactly the commands deployments use', () => {
    expect(Object.keys(runtimePkg.scripts).sort()).toEqual(['bot:start', 'start'])
  })
})
