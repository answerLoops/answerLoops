import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Container + deployment config validation.
// No Docker daemon needed — validates file structure, config syntax, and
// required environment variables are documented in the compose files.

const ROOT = process.cwd()

describe('Dockerfile: multi-stage build integrity', () => {
  const dockerfilePath = path.join(ROOT, 'Dockerfile')

  it('Dockerfile exists', () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true)
  })

  it('defines deps, build, and runner stages', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    expect(content).toContain('AS deps')
    expect(content).toContain('AS build')
    expect(content).toContain('AS runner')
  })

  it('runner stage uses node:22', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    expect(content).toMatch(/FROM node:22/)
  })

  it('runner stage runs as non-root user', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    expect(content).toContain('USER app')
  })

  it('exposes port 3000', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    expect(content).toContain('EXPOSE 3000')
  })

  it('build stage copies pnpm-workspace.yaml', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    expect(content).toContain('pnpm-workspace.yaml')
  })

  // Regression guard for fix/railway-deploy-unblock: the runner stage must run
  // `apk upgrade` so the production image ships OS packages level with upstream
  // and the publish-image scan stays green on release builds. `apk add
  // --no-cache` already exists in the deps stage, so these assertions match
  // `apk upgrade` specifically.
  const runnerStage = () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    const start = content.indexOf('AS runner')
    expect(start).toBeGreaterThan(-1)
    // runner is the final stage — no further FROM after it
    const rest = content.slice(start)
    expect(rest).not.toMatch(/\nFROM /)
    return rest
  }

  it('runner stage runs apk upgrade to pull OS security patches', () => {
    expect(runnerStage()).toMatch(/RUN apk upgrade --no-cache/)
  })

  it('apk upgrade is its own layer, before the COPY --from=build', () => {
    const stage = runnerStage()
    const upgradeIdx = stage.search(/RUN apk upgrade --no-cache/)
    const copyIdx = stage.search(/COPY .*--from=build/)
    expect(upgradeIdx).toBeGreaterThan(-1)
    expect(copyIdx).toBeGreaterThan(-1)
    expect(upgradeIdx).toBeLessThan(copyIdx)
  })

  it('apk upgrade appears only in the runner stage, not earlier stages', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf-8')
    const before = content.slice(0, content.indexOf('AS runner'))
    expect(before).not.toMatch(/apk upgrade/)
  })
})

describe('docker-compose.yml: dev stack', () => {
  const composePath = path.join(ROOT, 'docker-compose.yml')

  it('docker-compose.yml exists', () => {
    expect(fs.existsSync(composePath)).toBe(true)
  })

  it('defines postgres service', () => {
    const content = fs.readFileSync(composePath, 'utf-8')
    expect(content).toContain('postgres:')
    expect(content).toContain('POSTGRES_USER')
    expect(content).toContain('POSTGRES_DB')
  })

  it('defines app service with healthcheck dependency', () => {
    const content = fs.readFileSync(composePath, 'utf-8')
    expect(content).toContain('service_healthy')
  })

  it('defines bot service', () => {
    const content = fs.readFileSync(composePath, 'utf-8')
    expect(content).toContain('bot:')
    expect(content).toContain('BOT_TARGET_URL')
  })

  it('postgres has healthcheck', () => {
    const content = fs.readFileSync(composePath, 'utf-8')
    expect(content).toContain('pg_isready')
  })

  it('DATABASE_URL uses postgres service hostname', () => {
    const content = fs.readFileSync(composePath, 'utf-8')
    expect(content).toContain('postgres://community:community@postgres:5432/community')
  })
})

describe('docker-compose.prod.yml: production stack', () => {
  const composeProdPath = path.join(ROOT, 'docker-compose.prod.yml')

  it('docker-compose.prod.yml exists', () => {
    expect(fs.existsSync(composeProdPath)).toBe(true)
  })

  it('uses runner target image', () => {
    const content = fs.readFileSync(composeProdPath, 'utf-8')
    expect(content).toContain('runner')
  })

  it('sets NODE_ENV=production', () => {
    const content = fs.readFileSync(composeProdPath, 'utf-8')
    expect(content).toContain('NODE_ENV=production')
  })

  it('defines restart policy', () => {
    const content = fs.readFileSync(composeProdPath, 'utf-8')
    expect(content).toContain('restart: unless-stopped')
  })
})

describe('.dockerignore: sensitive files excluded', () => {
  const ignorePath = path.join(ROOT, '.dockerignore')

  it('.dockerignore exists', () => {
    expect(fs.existsSync(ignorePath)).toBe(true)
  })

  it('excludes .env files', () => {
    const content = fs.readFileSync(ignorePath, 'utf-8')
    expect(content).toMatch(/\.env/)
  })

  it('excludes node_modules', () => {
    const content = fs.readFileSync(ignorePath, 'utf-8')
    expect(content).toContain('node_modules')
  })
})

describe('pnpm-workspace.yaml: workspace config', () => {
  it('pnpm-workspace.yaml exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'pnpm-workspace.yaml'))).toBe(true)
  })
})

describe('docs/docs.json: Mintlify v2 config', () => {
  const docsConfigPath = path.join(ROOT, 'docs', 'docs.json')

  it('docs.json exists (not mint.json)', () => {
    expect(fs.existsSync(docsConfigPath)).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'docs', 'mint.json'))).toBe(false)
  })

  it('has required v2 fields', () => {
    const config = JSON.parse(fs.readFileSync(docsConfigPath, 'utf-8')) as Record<string, unknown>
    expect(config).toHaveProperty('theme')
    expect(config).toHaveProperty('name')
    expect(config).toHaveProperty('navigation')
    expect(typeof config.navigation).toBe('object')
    expect(Array.isArray(config.navigation)).toBe(false) // must be object in v2
  })

  it('navigation has groups array', () => {
    const config = JSON.parse(fs.readFileSync(docsConfigPath, 'utf-8')) as {
      navigation: { groups: Array<{ group: string; pages: string[] }> }
    }
    expect(Array.isArray(config.navigation.groups)).toBe(true)
    expect(config.navigation.groups.length).toBeGreaterThan(0)
  })
})
