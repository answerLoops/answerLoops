import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// The slim runner image copies a hand-picked set of directories and relies on
// Next.js file tracing for everything else. Anything the app reads from disk
// with a path built at runtime is invisible to tracing, so it has to be either
// copied by the runner or listed in outputFileTracingIncludes. These checks
// keep those lists in step with the source, the bot bundle in step with the
// base image, and the build context free of stale local output.

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

const dockerfile = read('Dockerfile')
const stages = dockerfile.split(/^FROM /m)
const depsStage = stages.find((s) => /^\S+ AS deps\b/.test(s))!
const runner = stages.find((s) => /^\S+ AS runner\b/.test(s))!
const rootPkg = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type TracedConfig = { output?: string; outputFileTracingIncludes?: Record<string, string[]> }

async function loadConfig(standalone: string | undefined): Promise<TracedConfig> {
  vi.stubEnv('NEXT_OUTPUT_STANDALONE', standalone ?? '')
  vi.resetModules()
  return (await import('@/next.config')).default as TracedConfig
}

/** Minimal glob matcher for the tracing include patterns: `**`, `*` and literals. */
function globToRegExp(glob: string): RegExp {
  const src = glob
    .replace(/^\.\//, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replaceAll('\u0000', '(?:.*/)?')
    .replaceAll('\u0001', '.*')
  return new RegExp(`^${src}$`)
}

/**
 * Files matching a tracing glob, resolved segment by segment so a pattern under
 * node_modules/.pnpm never walks the whole store.
 */
function expandGlob(glob: string): string[] {
  const segs = glob.replace(/^\.\//, '').split('/')
  const full = globToRegExp(glob)
  const out: string[] = []
  const walkAll = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walkAll(rel)
      else if (full.test(rel)) out.push(rel)
    }
  }
  const step = (dir: string, i: number) => {
    const seg = segs[i]
    if (seg === '**') return walkAll(dir)
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) return
    const segRe = globToRegExp(seg)
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!segRe.test(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (i === segs.length - 1) {
        if (e.isFile()) out.push(rel)
      } else if (e.isDirectory() || e.isSymbolicLink()) step(rel, i + 1)
    }
  }
  step('', 0)
  return out
}

/** Destinations (relative to /app) of every runner COPY from the build stage, except the standalone root. */
function runnerCopyDestinations(): string[] {
  return [...runner.matchAll(/^COPY [^\n]*--from=build \/app\/(\S+) (\S+)\s*$/gm)]
    .filter(([, src]) => src !== '.next/standalone')
    .map(([, , dest]) => dest.replace(/^\.\//, '').replace(/\/$/, ''))
}

async function tracingIncludes(): Promise<string[]> {
  const cfg = await loadConfig('1')
  return cfg.outputFileTracingIncludes?.['/*'] ?? []
}

describe('next.config: standalone output and tracing includes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('emits standalone output when the Docker build turns it on', async () => {
    expect((await loadConfig('1')).output).toBe('standalone')
  })

  it.each([undefined, '0', 'true'])('leaves output unset when NEXT_OUTPUT_STANDALONE is %s, so local next start keeps working', async (v) => {
    const cfg = await loadConfig(v)
    expect(cfg.output).toBeUndefined()
    expect('output' in cfg).toBe(false)
  })

  it('traces the pdf-parse worker at the exact path file-parsers.ts hands to PDFParse.setWorker', async () => {
    const src = read('lib/ingest/file-parsers.ts')
    const setWorker = src.match(/PDFParse\.setWorker\(\s*path\.join\(\s*process\.cwd\(\)\s*,\s*['"]([^'"]+)['"]\s*\)/)
    expect(setWorker, 'file-parsers.ts no longer points pdf-parse at a cwd-relative worker; update this test').not.toBeNull()
    const workerPath = setWorker![1]
    // The file has to exist where the code looks for it, or the glob matches nothing.
    expect(fs.existsSync(path.join(ROOT, workerPath))).toBe(true)
    const includes = await tracingIncludes()
    expect(includes.some((g) => globToRegExp(g).test(workerPath)), `no tracing include covers ${workerPath}`).toBe(true)
  })

  it('every tracing include matches at least one installed file, so a renamed package cannot silently trace nothing', async () => {
    const includes = await tracingIncludes()
    expect(includes.length).toBeGreaterThan(0)
    for (const glob of includes) {
      expect(expandGlob(glob).length, `tracing include ${glob} matches no installed file`).toBeGreaterThan(0)
    }
  })

  it('includes Sentry’s server-runtime-injection ESM build', async () => {
    const includes = await tracingIncludes()
    expect(includes.some((g) => g.includes('@sentry/server-runtime-injection/build/esm/'))).toBe(true)
  })
})

describe('runtime disk reads are shipped in the slim image', () => {
  const SCAN_DIRS = ['app', 'lib', 'bot', 'components']
  const SOURCE = /\.(ts|tsx|mts|cts|js|mjs)$/

  function sourceFiles(dir: string): string[] {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) return []
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(rel)
      return SOURCE.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : []
    })
  }

  /** Every cwd-relative path read at runtime, derived from the source. Force-static routes render at build time and are skipped. */
  function runtimeReads(): { file: string; rel: string }[] {
    const reads: { file: string; rel: string }[] = []
    for (const file of SCAN_DIRS.flatMap(sourceFiles)) {
      const src = read(file)
      if (!src.includes('process.cwd()')) continue
      if (/export const dynamic\s*=\s*['"]force-static['"]/.test(src)) continue
      const joins = [...src.matchAll(/\b(?:join|resolve)\(\s*process\.cwd\(\)\s*,((?:\s*['"][^'"`]+['"]\s*,?)+)\s*\)/g)]
      const total = src.match(/process\.cwd\(\)/g)!.length
      // A cwd read in some other shape (template string, variable) cannot be
      // checked here, so make it fail loudly rather than slip through.
      expect(joins.length, `${file} uses process.cwd() in a form this test cannot resolve; extend the matcher`).toBe(total)
      for (const m of joins) {
        const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((p) => p[1])
        reads.push({ file, rel: path.posix.normalize(parts.join('/')).replace(/^\.\//, '') })
      }
    }
    return reads
  }

  it('finds the known runtime reads, so the scan itself is not broken', () => {
    const rels = runtimeReads().map((r) => r.rel)
    expect(rels).toContain('drizzle')
    expect(rels).toContain('lib/marketing/fonts/Geist-Bold.ttf')
    expect(rels).toContain('node_modules/pdf-parse/dist/worker/pdf.worker.mjs')
  })

  it('every path read from disk at runtime is copied by the runner or traced into standalone', async () => {
    const dests = runnerCopyDestinations()
    const includes = (await tracingIncludes()).map(globToRegExp)
    vi.unstubAllEnvs()
    vi.resetModules()
    const missing = runtimeReads().filter(
      ({ rel }) => !dests.some((d) => rel === d || rel.startsWith(`${d}/`)) && !includes.some((re) => re.test(rel))
    )
    expect(missing, `not in the image: ${missing.map((m) => `${m.rel} (${m.file})`).join(', ')}`).toEqual([])
  })
})

describe('bot bundle', () => {
  const script = rootPkg.scripts['bot:build']
  const flag = (name: string) => script.match(new RegExp(`--${name}=(\\S+)`))?.[1]

  it('bundles the same entry the dev bot:start runs', () => {
    const entry = rootPkg.scripts['bot:start'].match(/tsx\s+(\S+\.ts)/)?.[1]
    expect(entry).toBe('bot/index.ts')
    expect(script).toMatch(new RegExp(`^esbuild ${entry!.replace('.', '\\.')}\\s`))
    expect(fs.existsSync(path.join(ROOT, entry!))).toBe(true)
  })

  it('inlines every dependency, since the runner has no node_modules for the bot', () => {
    expect(script).toContain('--bundle')
    expect(script).not.toMatch(/--external[:=]/)
    expect(script).not.toMatch(/--packages=external/)
  })

  it('targets Node as CommonJS, so __dirname and require keep working in bundled dependencies', () => {
    expect(flag('platform')).toBe('node')
    expect(flag('format')).toBe('cjs')
    expect(flag('outfile')).toMatch(/\.cjs$/)
  })

  it('targets the same Node major as the runner base image', () => {
    const runnerNode = runner.match(/^node:(\d+)/)?.[1]
    expect(runnerNode).toBeDefined()
    expect(flag('target')).toBe(`node${runnerNode}`)
  })

  it('esbuild is a declared dependency, so the deps stage installs it', () => {
    expect(rootPkg.devDependencies?.esbuild ?? rootPkg.dependencies?.esbuild).toBeDefined()
  })
})

describe('build context and git hygiene for the bundle', () => {
  it('.dockerignore excludes dist, so a stale local bundle never reaches the build stage', () => {
    const lines = read('.dockerignore').split('\n').map((l) => l.trim())
    expect(lines.some((l) => ['dist', 'dist/', '/dist', '/dist/'].includes(l))).toBe(true)
    expect(lines).not.toContain('!dist')
    expect(lines.filter((l) => l.startsWith('!dist'))).toEqual([])
  })

  it('.gitignore ignores the bundle output directory', () => {
    const lines = read('.gitignore').split('\n').map((l) => l.trim())
    expect(lines.some((l) => ['dist', 'dist/', '/dist', '/dist/'].includes(l))).toBe(true)
  })
})

describe('runner: pnpm stays, npm goes', () => {
  const installRun = runner.match(/^RUN npm install -g pnpm@(?:[^\n]*\\\n)*[^\n]*/m)?.[0] ?? ''

  it('installs pnpm at the same pinned version as the deps stage', () => {
    const depsVersion = depsStage.match(/npm install -g pnpm@(\S+)/)?.[1]
    const runnerVersion = installRun.match(/npm install -g pnpm@(\S+)/)?.[1]
    expect(depsVersion).toBeDefined()
    expect(runnerVersion).toBe(depsVersion)
  })

  it('removes npm, npx and corepack in the same layer that installed pnpm', () => {
    const rm = installRun.slice(installRun.indexOf('npm install -g pnpm'))
    for (const p of ['/usr/local/lib/node_modules/npm', '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/corepack']) {
      expect(rm).toContain(p)
    }
    // pnpm itself must survive: it is what `pnpm start` and `pnpm bot:start` run.
    expect(rm).not.toMatch(/\/usr\/local\/(?:bin|lib\/node_modules)\/pnpm\b/)
  })

  it('no later runner instruction calls npm or npx', () => {
    const after = runner.slice(runner.indexOf(installRun) + installRun.length)
    const runs = after.split('\n').filter((l) => /^(RUN|CMD|ENTRYPOINT)\b/.test(l.trim()))
    for (const l of runs) expect(l).not.toMatch(/\b(npm|npx)\s/)
  })
})
