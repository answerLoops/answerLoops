import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Infra guards for included platform AI usage and the embedding-model pin
// (drizzle/0051, drizzle/0052). Fills the gaps the feature-level tests leave:
//   - the migration runner (lib/db/migrate.ts) applies drizzle/*.sql sorted by
//     name and splits on "--> statement-breakpoint", so a duplicate numeric
//     prefix, an empty chunk, or a non-idempotent DDL statement breaks deploys;
//   - schema.ts and the SQL drifting apart only fails at runtime inside raw sql``;
//   - a leftover reference to the removed 5-ticket trial anywhere in the tree;
//   - an unagreed PLATFORM_AI_* env var, or one leaking into self-host config/docs;
//   - route segment config and the bot-secret check running before any DB work;
//   - sql.raw() in the spend queries receiving anything but allow-listed columns.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

const MIGRATIONS = ['drizzle/0051_platform_ai_budget.sql', 'drizzle/0052_embedding_model_pin.sql']

function sqlFiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'drizzle')).filter((f) => f.endsWith('.sql'))
}

// Same split the runner uses, minus .filter(Boolean), so empty chunks surface.
function chunks(sql: string): string[] {
  return sql.split('--> statement-breakpoint').map((s) => s.trim())
}

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim()
}

describe('migration file naming and runner compatibility', () => {
  it('every drizzle/*.sql numeric prefix is unique', () => {
    const prefixes = sqlFiles().map((f) => f.match(/^(\d+)_/)?.[1]).filter((p): p is string => !!p)
    const dupes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i)
    expect(dupes).toEqual([])
  })

  it('0051 and 0052 exist and the runner applies 0052 after 0051 (and after every earlier file)', () => {
    const sorted = sqlFiles().sort()
    const i51 = sorted.indexOf('0051_platform_ai_budget.sql')
    const i52 = sorted.indexOf('0052_embedding_model_pin.sql')
    expect(i51).toBeGreaterThanOrEqual(0)
    expect(i52).toBe(i51 + 1)
    // 0052 backfills from ai_configs/kb_articles/ticket_embeddings, which
    // older migrations create; nothing numbered below it may sort after it.
    for (const f of sorted.slice(i52 + 1)) expect(Number(f.slice(0, 4))).toBeGreaterThan(52)
  })

  it.each(MIGRATIONS)('%s has no empty or comment-only statement chunk', (file) => {
    for (const c of chunks(read(file))) expect(stripComments(c).length).toBeGreaterThan(0)
  })

  it.each(MIGRATIONS)('%s holds exactly one SQL statement per chunk', (file) => {
    for (const c of chunks(read(file))) {
      const body = stripComments(c).replace(/;\s*$/, '')
      expect(body).not.toContain(';')
    }
  })

  it.each(MIGRATIONS)('%s makes every CREATE/ALTER idempotent', (file) => {
    for (const c of chunks(read(file))) {
      const stmt = stripComments(c)
      if (/^CREATE\s+TABLE/i.test(stmt)) expect(stmt).toMatch(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i)
      if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt)) expect(stmt).toMatch(/INDEX\s+IF\s+NOT\s+EXISTS/i)
      if (/^ALTER\s+TABLE/i.test(stmt)) {
        for (const m of stmt.matchAll(/\b(ADD|DROP)\s+COLUMN\b(\s+IF\s+(NOT\s+)?EXISTS)?/gi)) {
          const action = m[1].toUpperCase()
          expect(m[2], `${action} COLUMN without IF ${action === 'ADD' ? 'NOT ' : ''}EXISTS in: ${stmt}`).toBeTruthy()
          if (action === 'ADD') expect(m[3]).toBeTruthy()
          else expect(m[3]).toBeFalsy()
        }
      }
    }
  })

  it.each(MIGRATIONS)('%s backfill UPDATEs are re-run safe (guarded by a WHERE clause)', (file) => {
    for (const c of chunks(read(file))) {
      const stmt = stripComments(c)
      if (/^UPDATE\b/i.test(stmt)) expect(stmt).toMatch(/\bWHERE\b/i)
    }
  })
})

// Pull the body of one pgTable(...) declaration out of schema.ts.
function schemaBlock(table: string): string {
  const src = read('lib/db/schema.ts')
  const start = src.search(new RegExp(`pgTable\\(\\s*'${table}'`))
  expect(start, `pgTable('${table}') not found in schema.ts`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf('\nexport const ', start)
  return src.slice(start, next === -1 ? undefined : next)
}

function schemaColumns(table: string): Set<string> {
  const block = schemaBlock(table)
  const cols = [...block.matchAll(/:\s*[a-zA-Z]+\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1])
  return new Set(cols)
}

describe('schema.ts <-> migration column parity', () => {
  it('platform_ai_usage declares exactly the columns 0051 creates', () => {
    const sql = read('drizzle/0051_platform_ai_budget.sql')
    const create = sql.match(/CREATE TABLE IF NOT EXISTS platform_ai_usage\s*\(([\s\S]*?)\n\);/i)
    expect(create).toBeTruthy()
    const sqlCols = create![1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^PRIMARY KEY/i.test(l))
      .map((l) => l.split(/\s+/)[0])
      .sort()
    expect(sqlCols).toEqual(['chat_spend_micros', 'embedding_spend_micros', 'org_id', 'period'])
    expect([...schemaColumns('platform_ai_usage')].sort()).toEqual(sqlCols)
  })

  it('platform_ai_usage primary key matches (org_id, period) in schema.ts', () => {
    expect(schemaBlock('platform_ai_usage')).toMatch(/primaryKey\(\{\s*columns:\s*\[t\.orgId,\s*t\.period\]\s*\}\)/)
  })

  it('every column added by 0051/0052 is declared on the matching pgTable', () => {
    for (const file of MIGRATIONS) {
      for (const m of read(file).matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/gi)) {
        const [, table, col] = m
        expect(schemaColumns(table).has(col), `${table}.${col} (from ${file}) missing in schema.ts`).toBe(true)
      }
    }
  })

  it('the column 0051 drops is no longer declared on orgs', () => {
    expect(schemaColumns('orgs').has('platform_key_trial_used')).toBe(false)
  })
})

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return out
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(rel)
  }
  return out
}

const SOURCE_FILES = ['lib', 'app', 'bot', 'components'].flatMap((d) => walk(d))

describe('the removed 5-ticket trial is gone from the whole tree', () => {
  it('scans a non-trivial number of files', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(50)
  })

  it('no source file under lib/, app/, bot/, components/ references it', () => {
    const banned = /platform_key_trial_used|platformKeyTrialUsed|PLATFORM_KEY_TRIAL_LIMIT|platform-key-trial|getPlatformKeyTrialStatus|reservePlatformKeyTrial/
    const offenders = SOURCE_FILES.filter((f) => banned.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('the trial-status route was removed in favour of usage-status', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/api/ai-config/trial-status/route.ts'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'app/api/ai-config/usage-status/route.ts'))).toBe(true)
  })
})

const AGREED_PLATFORM_AI_VARS = [
  'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD',
  'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_PLAN_CHAT_BUDGET_USD',
  'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_CHAT_MODEL',
  'PLATFORM_AI_FAST_MODEL',
  'PLATFORM_AI_EMBEDDING_MODEL',
]

describe('PLATFORM_AI_* env vars', () => {
  const referenced = new Set(
    SOURCE_FILES.flatMap((f) => [...read(f).matchAll(/\bPLATFORM_AI_[A-Z0-9_]+/g)].map((m) => m[0])),
  )

  it('source references only the seven agreed names', () => {
    const unknown = [...referenced].filter((v) => !AGREED_PLATFORM_AI_VARS.includes(v))
    expect(unknown).toEqual([])
  })

  it('all seven agreed names are actually read somewhere under lib/', () => {
    const libRefs = new Set(
      walk('lib').flatMap((f) => [...read(f).matchAll(/\bPLATFORM_AI_[A-Z0-9_]+/g)].map((m) => m[0])),
    )
    for (const v of AGREED_PLATFORM_AI_VARS) expect(libRefs.has(v), `${v} not read under lib/`).toBe(true)
  })

  it('none appears in .env.example (hosted-only ops config)', () => {
    const p = path.join(ROOT, '.env.example')
    if (!fs.existsSync(p)) return
    expect(fs.readFileSync(p, 'utf-8')).not.toMatch(/PLATFORM_AI_/)
  })

  it('none appears in content/docs (hosted-only ops config)', () => {
    const docs: string[] = []
    const visit = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) visit(rel)
        else if (/\.(mdx?|json)$/.test(e.name)) docs.push(rel)
      }
    }
    visit('content/docs')
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.filter((f) => /PLATFORM_AI_/.test(read(f)))).toEqual([])
  })
})

describe('route segment config', () => {
  it('usage-status is force-dynamic', () => {
    expect(read('app/api/ai-config/usage-status/route.ts')).toMatch(/^export const dynamic = 'force-dynamic'$/m)
  })

  it('embedding-migration/run is force-dynamic on the nodejs runtime', () => {
    const src = read('app/api/kb/embedding-migration/run/route.ts')
    expect(src).toMatch(/^export const dynamic = 'force-dynamic'$/m)
    expect(src).toMatch(/^export const runtime = 'nodejs'$/m)
  })

  it('embedding-migration/run checks the bot secret as the first statement of POST', () => {
    const src = read('app/api/kb/embedding-migration/run/route.ts')
    const body = src.slice(src.indexOf('export async function POST'))
    const gate = body.indexOf('isPlatformBotRequest(request)')
    expect(gate).toBeGreaterThan(0)
    for (const call of ['getPlatformModel(', 'getDeploymentMode(', 'listMigrationCandidates(', 'runEmbeddingMigration(']) {
      const at = body.indexOf(call)
      expect(at, `${call} not found in POST`).toBeGreaterThan(0)
      expect(gate).toBeLessThan(at)
    }
  })

  it('embedding-migration/run touches no DB or model config when unauthorized', async () => {
    vi.resetModules()
    const list = vi.fn()
    const run = vi.fn()
    const model = vi.fn()
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => false }))
    vi.doMock('@/lib/kb/embedding-migration', () => ({ listMigrationCandidates: list, runEmbeddingMigration: run }))
    vi.doMock('@/lib/ai/platform-models', () => ({ getPlatformModel: model }))
    const { POST } = await import('@/app/api/kb/embedding-migration/run/route')
    const res = await POST(new Request('https://x.test/api', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(list).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(model).not.toHaveBeenCalled()
    vi.doUnmock('@/lib/http/bearer-auth')
    vi.doUnmock('@/lib/kb/embedding-migration')
    vi.doUnmock('@/lib/ai/platform-models')
  })
})

describe('sql.raw in lib/billing/platform-ai-budget.ts', () => {
  const src = read('lib/billing/platform-ai-budget.ts')

  function mapValues(name: string): string[] {
    const m = src.match(new RegExp(`const ${name}: Record<BudgetKind, string> = \\{([\\s\\S]*?)\\}`))
    expect(m, `${name} map not found`).toBeTruthy()
    return [...m![1].matchAll(/^\s*(\w+):\s*'([a-z_]+)',?\s*$/gm)].map((x) => `${x[1]}=${x[2]}`)
  }

  it('the column allow-lists name only the spend columns from 0051', () => {
    expect(mapValues('TRIAL_COLUMN').sort()).toEqual(['chat=trial_chat_spend_micros', 'embedding=trial_embedding_spend_micros'])
    expect(mapValues('PLAN_COLUMN').sort()).toEqual(['chat=chat_spend_micros', 'embedding=embedding_spend_micros'])
  })

  it('every sql.raw() argument is an allow-list lookup, never a caller value', () => {
    const args = [...src.matchAll(/sql\.raw\(([^)]*)\)/g)].map((m) => m[1].trim())
    expect(args.length).toBeGreaterThanOrEqual(4)
    for (const a of args) expect(a).toMatch(/^(TRIAL_COLUMN|PLAN_COLUMN)\[kind\]$/)
  })

  it('kind is typed as BudgetKind in both getSpendMicros and recordSpend', () => {
    expect(src).toMatch(/export async function getSpendMicros\([^)]*kind: BudgetKind/)
    expect(src).toMatch(/export async function recordSpend\([^)]*kind: BudgetKind/)
  })

  it('no other module under lib/billing or lib/ai feeds sql.raw', () => {
    const offenders = [...walk('lib/billing'), ...walk('lib/ai')]
      .filter((f) => f !== path.join('lib', 'billing', 'platform-ai-budget.ts'))
      .filter((f) => /sql\.raw\(/.test(read(f)))
    expect(offenders).toEqual([])
  })
})
