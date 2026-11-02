import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createRailwayContext, project } from 'railway/iac'
import program, { partial } from '../../.railway/railway'

/**
 * Guards for .railway/railway.ts, Railway's Infrastructure as Code file for
 * the production `app` and `bot` services. It is evaluated here the same way
 * the Railway CLI evaluates it, so these assertions are about the settings
 * Railway would actually receive, not about how the source happens to be
 * written. File-system and in-process only: no network, no live Railway.
 *
 * The CLI-side plan (`railway config plan`) is still the final check before an
 * apply; this suite catches the mistakes that are visible without a login.
 */

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

interface ServiceNode {
  address: string
  name: string
  source?: { repo?: string; branch?: string; checkSuites?: boolean }
  build?: { builder?: string; dockerfilePath?: string }
  deploy?: {
    startCommand?: string
    healthcheckPath?: string
    healthcheckTimeout?: number
    restartPolicyType?: string
    multiRegionConfig?: Record<string, { numReplicas?: number }>
  }
  networking?: { customDomains?: Record<string, { port?: number }> }
  variables?: unknown
  env?: unknown
}

interface Evaluated {
  name: string
  variables?: { managed?: boolean }
  resources: ServiceNode[]
}

let evaluated: Evaluated
const service = (name: string) => {
  const found = evaluated.resources.find((r) => r.name === name)
  if (!found) throw new Error(`service "${name}" is not declared in .railway/railway.ts`)
  return found
}

beforeAll(async () => {
  evaluated = (await program(
    createRailwayContext({ command: 'plan', environmentName: 'production' }),
    project
  )) as unknown as Evaluated
})

describe('Railway IaC: what the file declares', () => {
  it('manages exactly the app and bot services, in the AnswerLoops project', () => {
    expect(evaluated.name).toBe('AnswerLoops')
    expect(evaluated.resources.map((r) => r.address).sort()).toEqual(['service.app', 'service.bot'])
  })

  it('scopes ownership with a named partial, so unlisted resources are never touched', () => {
    expect(partial).toBe('answerloops-services')
  })

  it('both services deploy from this repo on main, after CI passes', () => {
    for (const name of ['app', 'bot']) {
      expect(service(name).source, name).toMatchObject({
        repo: 'answerLoops/answerLoops',
        branch: 'main',
        checkSuites: true,
      })
    }
  })

  it('runs one replica of each in the same region', () => {
    for (const name of ['app', 'bot']) {
      expect(service(name).deploy?.multiRegionConfig, name).toEqual({ 'us-east4-eqdc4a': { numReplicas: 1 } })
    }
  })

  // Railway's default is already "restart on failure" and it reads that back as
  // unset, so declaring ON_FAILURE would leave a permanent diff in every plan.
  // Only a non-default policy belongs in this file.
  it('leaves the restart policy at the platform default, or sets a non-default one', () => {
    for (const name of ['app', 'bot']) {
      expect(service(name).deploy?.restartPolicyType, name).not.toBe('ON_FAILURE')
    }
  })
})

describe('Railway IaC: builds from the Dockerfile', () => {
  it('pins the Dockerfile builder for both services, to a Dockerfile that exists', () => {
    for (const name of ['app', 'bot']) {
      const build = service(name).build
      expect(build?.builder, name).toBe('DOCKERFILE')
      expect(fs.existsSync(path.join(ROOT, build?.dockerfilePath ?? '<unset>')), name).toBe(true)
    }
  })
})

describe('Railway IaC: start commands', () => {
  // The app sets no start command on purpose: it relies on the Dockerfile CMD.
  // If that CMD changes, production would silently boot the wrong process.
  it('the app has no start command of its own, and the Dockerfile final CMD is pnpm start', () => {
    expect(service('app').deploy?.startCommand).toBeUndefined()
    const cmds = read('Dockerfile')
      .split('\n')
      .filter((l) => /^CMD\s/.test(l.trim()))
    expect(cmds.length).toBeGreaterThan(0)
    expect(cmds[cmds.length - 1].trim()).toBe('CMD ["pnpm", "start"]')
  })

  // Without this the bot would fall back to the Dockerfile CMD and run a
  // second copy of the web app: the Discord listener, sweeps, KB sync and
  // trial reminders would stop, with no deploy error.
  it('the bot starts the bot process, and that package script exists', () => {
    const start = service('bot').deploy?.startCommand
    expect(start).toBe('pnpm bot:start')
    const script = start!.replace(/^pnpm /, '')
    expect(JSON.parse(read('package.json')).scripts[script]).toBeTruthy()
  })
})

describe('Railway IaC: health check and domains', () => {
  const dockerfilePath = () =>
    read('Dockerfile').match(/HEALTHCHECK[\s\S]*?127\.0\.0\.1:3000(\/\S+?)\s/)?.[1]

  // A path drift between Railway and the image HEALTHCHECK would make deploys
  // fail health gating or probe a 404.
  it('the app health check path matches the Dockerfile HEALTHCHECK and a real route', () => {
    const deploy = service('app').deploy
    expect(deploy?.healthcheckPath).toBe('/api/health')
    expect(deploy?.healthcheckPath).toBe(dockerfilePath())
    expect(fs.existsSync(path.join(ROOT, 'app', 'api', 'health', 'route.ts'))).toBe(true)
    expect(deploy?.healthcheckTimeout).toBe(30)
  })

  it('serves the app on both custom domains, port 3000', () => {
    expect(service('app').networking?.customDomains).toEqual({
      'answerloops.com': { port: 3000 },
      'app.answerloops.com': { port: 3000 },
    })
  })

  it('the bot serves no HTTP, so it has no health check and no domains', () => {
    expect(service('bot').deploy?.healthcheckPath).toBeUndefined()
    expect(service('bot').networking).toBeUndefined()
  })
})

describe('Railway IaC: secrets stay out of the repository', () => {
  it('tells the CLI to leave environment variables unmanaged', () => {
    // Without this, `railway config plan` refuses and lists every variable.
    expect(evaluated.variables).toEqual({ managed: false })
  })

  it('declares no variables on any service', () => {
    for (const r of evaluated.resources) {
      expect(Object.keys((r.variables ?? {}) as object), r.name).toEqual([])
      expect(Object.keys((r.env ?? {}) as object), r.name).toEqual([])
    }
  })

  it('the source contains no secret-looking values and reads no environment', () => {
    const iac = read('.railway/railway.ts')
    expect(iac).not.toMatch(/(sk_live|sk_test|ghp_|xox[bp]-|postgres(ql)?:\/\/)/)
    expect(iac).not.toContain('process.env')
  })
})

describe('Railway IaC: the deprecated config files are gone', () => {
  // Config as Code stops being read on 2026-12-01, and a service cannot be
  // managed by both systems.
  it.each(['railway.toml', 'railway.bot.toml', 'railway.json'])('%s does not exist', (file) => {
    expect(fs.existsSync(path.join(ROOT, file))).toBe(false)
  })

  it('docs and compose files do not point readers at the removed files or builder', () => {
    for (const rel of ['ARCHITECTURE.md', 'content/docs/self-hosting/production.mdx', 'docker-compose.prod.yml']) {
      const content = read(rel)
      expect(content.toLowerCase(), rel).not.toContain('nixpacks')
      const live = content
        .split('\n')
        .filter((l) => !/deprecated|replaces|replaced|removed/i.test(l))
        .join('\n')
      expect(live, rel).not.toMatch(/railway(\.bot)?\.toml/)
    }
  })
})

describe('Railway IaC: tooling', () => {
  const pkg = JSON.parse(read('package.json'))

  // The CLI/IaC package is tooling only; in dependencies it would ship in the
  // runtime image.
  it('railway is a devDependency, not a runtime dependency', () => {
    expect(pkg.devDependencies?.railway).toBeDefined()
    expect(pkg.dependencies?.railway).toBeUndefined()
  })

  // The IaC schema is version-sensitive and the SDK is in beta.
  it('railway is caret-pinned to a 3.x release', () => {
    expect(pkg.devDependencies.railway).toMatch(/^\^3\.\d+\.\d+$/)
  })

  // The file used to be excluded, which is how an invalid option went unseen.
  it('the app type-check covers .railway', () => {
    expect(JSON.parse(read('tsconfig.json')).exclude).not.toContain('.railway')
  })
})
