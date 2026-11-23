import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Infra guards for re-titling earlier page imports that the feature tests
// leave open, all runnable without a database:
//   - migration 0086 against the runner's rules (lib/db/migrate.ts splits on
//     "--> statement-breakpoint" and runs each chunk with sql.raw);
//   - the scheduled pass is paid by us, so it must never reach the metered
//     embedding paths that charge a workspace's included usage;
//   - the lease, backoff and own-key clauses in the pass's SQL, as a no-DB
//     complement to kb-retitle-imports.postgres.test.ts;
//   - the bot-only route doing no work at all for an unauthorized caller.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const MIGRATION = 'drizzle/0086_kb_retitle_imports.sql'
const PASS = 'lib/kb/retitle-imports.ts'

const stripComments = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim()
// Same split the runner uses, minus .filter(Boolean), so an empty chunk surfaces.
const chunks = (s: string) => s.split('--> statement-breakpoint').map((c) => c.trim())
const squash = (s: string) => s.replace(/\s+/g, ' ')

describe('migration 0086 and the runner', () => {
  it('is a .sql file in drizzle/, which is all the runner picks up', () => {
    const runner = read('lib/db/migrate.ts')
    expect(runner).toMatch(/readdirSync\(migrationsDir\)\s*\.filter\(\(f\) => f\.endsWith\('\.sql'\)\)\s*\.sort\(\)/)
    expect(fs.readdirSync(path.join(ROOT, 'drizzle'))).toContain(path.basename(MIGRATION))
  })

  it('has no empty or comment-only chunk', () => {
    for (const c of chunks(read(MIGRATION))) expect(stripComments(c).length).toBeGreaterThan(0)
  })

  it('holds exactly one statement per chunk, so an "already exists" skip never swallows a sibling', () => {
    for (const c of chunks(read(MIGRATION))) {
      expect(stripComments(c).replace(/;\s*$/, '')).not.toContain(';')
    }
  })

  it('makes every ADD COLUMN and CREATE INDEX re-run safe, and guards its backfill with WHERE', () => {
    for (const c of chunks(read(MIGRATION))) {
      const stmt = stripComments(c)
      for (const m of stmt.matchAll(/\bADD\s+COLUMN\b(\s+IF\s+NOT\s+EXISTS)?/gi)) expect(m[1], stmt).toBeTruthy()
      if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt)) expect(stmt).toMatch(/INDEX\s+IF\s+NOT\s+EXISTS/i)
      if (/^UPDATE\b/i.test(stmt)) expect(stmt).toMatch(/\bWHERE\b/i)
    }
  })
})

describe('the re-title pass never charges included usage', () => {
  const src = read(PASS)
  const imports = [...src.matchAll(/^import[\s\S]*?from '([^']+)'/gm)].map((m) => m[1])

  it('does not import the metering wrappers or the metered embed helpers', () => {
    expect(imports).not.toContain('@/lib/ai/metering')
    expect(imports).not.toContain('@/lib/ai/embed')
    expect(imports).not.toContain('@/lib/ai/models')
    expect(src).not.toMatch(/\bmeter(Embedding|Language)Model\b/)
    expect(src).not.toMatch(/\b(embedText|embedTexts|embedTextWithModel|ownEmbeddingModel|platformEmbedding)\b/)
  })

  it('gets its embedding model only from passEmbeddingModel, the same handle the re-embed job uses', () => {
    expect(src).toMatch(/import \{[^}]*\bpassEmbeddingModel\b[^}]*\} from '@\/lib\/kb\/embedding-migration'/)
    expect(src.match(/\bembedMany\(\{ model,/g)).toHaveLength(1)
    expect(src.match(/const model = passEmbeddingModel\(/g)).toHaveLength(1)
  })

  it('passEmbeddingModel itself stays off the metering path', () => {
    const shared = read('lib/kb/embedding-migration.ts')
    expect(shared).not.toMatch(/from '@\/lib\/ai\/metering'/)
    expect(shared).not.toMatch(/\bmeterEmbeddingModel\b/)
  })
})

describe('the pass SQL (no-DB complement to the postgres tests)', () => {
  const src = read(PASS)
  const fnBody = (name: string) => {
    const start = src.indexOf(`function ${name}(`)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    return squash(src.slice(start, src.indexOf('\n}\n', start)))
  }

  it('candidates skip a held lease, back off exponentially with a cap, and leave own-key workspaces out', () => {
    const q = fnBody('listRetitleCandidates')
    expect(q).toContain("s.file_type = 'url' AND s.titles_version = 0")
    expect(q).toContain('(o.kb_retitle_lease_until IS NULL OR o.kb_retitle_lease_until < now())')
    expect(q).toContain("o.kb_retitle_attempted_at < now() - interval '5 minutes' * power(2, LEAST(o.kb_retitle_failures, 8))")
    expect(q).toMatch(/AND NOT COALESCE\(c\.embedding_base_url IS NOT NULL OR c\.embedding_api_key IS NOT NULL OR \(c\.chat_provider = 'openai' AND c\.chat_api_key IS NOT NULL\), false\)/)
    expect(q).toContain('ORDER BY o.kb_retitle_attempted_at ASC NULLS FIRST')
  })

  it('takes the lease only when it is free, and stamps the attempt time', () => {
    const q = fnBody('acquireLease')
    expect(q).toContain('kb_retitle_attempted_at = now()')
    expect(q).toContain('WHERE id = ${orgId} AND (kb_retitle_lease_until IS NULL OR kb_retitle_lease_until < now())')
  })

  it('renews and releases only a lease it still holds, and throws when renewal finds it gone', () => {
    const renew = fnBody('renewLease')
    expect(renew).toContain('extract(epoch from kb_retitle_lease_until)::text = ${lease.token}')
    expect(renew).toContain('throw new LeaseLostError(orgId)')
    const release = fnBody('releaseLease')
    expect(release.match(/WHERE id = \$\{orgId\} AND extract\(epoch from kb_retitle_lease_until\)::text = \$\{lease\.token\}/g)).toHaveLength(2)
    expect(release).toContain('kb_retitle_failures = 0')
    expect(release).toContain('kb_retitle_failures = kb_retitle_failures + 1')
  })

  it('always releases the lease, counting a failure unless the pass reached ok', () => {
    const run = squash(src.slice(src.indexOf('export async function runRetitlePass(')))
    expect(run).toMatch(/let ok = false try \{/)
    expect(run).toMatch(/\} finally \{ await releaseLease\(orgId, lease, ok\) \}/)
  })

  it('scopes every write to the workspace and makes the article write conditional on what it read', () => {
    const run = squash(src.slice(src.indexOf('export async function runRetitlePass(')))
    expect(run).toContain(
      'WHERE id = ${c.id} AND org_id = ${orgId} AND question = ${c.question} AND answer = ${c.answer} AND model = ${pinned}'
    )
    expect(run).toContain('UPDATE kb_sources SET titles_version = 1 WHERE id = ${source.id} AND org_id = ${orgId}')
  })
})

describe('POST /api/kb/retitle-imports/run when unauthorized', () => {
  it('touches no candidates, passes or deployment config', async () => {
    vi.resetModules()
    const list = vi.fn()
    const run = vi.fn()
    const mode = vi.fn(() => 'cloud')
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => false }))
    vi.doMock('@/lib/kb/retitle-imports', () => ({ listRetitleCandidates: list, runRetitlePass: run }))
    vi.doMock('@/lib/billing/plans', () => ({ getDeploymentMode: mode }))
    try {
      const { POST } = await import('@/app/api/kb/retitle-imports/run/route')
      const res = await POST(new Request('https://x.test/api', { method: 'POST' }))
      expect(res.status).toBe(401)
      expect(list).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
      expect(mode).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('@/lib/http/bearer-auth')
      vi.doUnmock('@/lib/kb/retitle-imports')
      vi.doUnmock('@/lib/billing/plans')
    }
  })
})
