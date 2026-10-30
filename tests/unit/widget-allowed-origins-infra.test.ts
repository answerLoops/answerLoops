import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableConfig } from 'drizzle-orm/pg-core'

// Infrastructure coverage for the widget origin-allowlist change:
//   drizzle/0020_widget_allowed_origins.sql
//   lib/db/schema.ts            (orgs.widgetAllowedOrigins)
//   lib/db/queries/widgets.ts   (setWidgetAllowedOrigins / getWidgetAllowedOrigins
//                                / getOrgByWidgetToken)
//   public/widget.js            (?parent=<origin> on the iframe src)
//
// The product behaviour of the allowlist — parsing, host matching, deny-by-
// default, the iframe-page enforcement, the refusal screen, the endpoint rate
// limits/body caps, and role gating — is covered by
// tests/unit/widget-surface-hardening.test.ts and is deliberately not repeated
// here. This file is only about the plumbing underneath it: does the migration
// actually run, does the Drizzle table agree with it, does the query layer emit
// org-scoped SQL that stores NULL rather than '', and does the loader script
// build a correct URL.
//
// No DB and no Docker: the query functions run against drizzle's pg-proxy
// driver, which hands us the compiled SQL instead of opening a socket, and
// widget.js runs inside node:vm against a hand-built DOM stub.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0020_widget_allowed_origins.sql'
const COLUMN = 'widget_allowed_origins'

function readFileAt(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const readMigration = () => readFileAt(path.join('drizzle', MIGRATION))

/** The migration with `-- ...` comments removed — the prose explains the design
 *  ("Nullable", "NULL/empty means unrestricted") and would otherwise satisfy or
 *  trip assertions that are meant to be about the SQL. */
const migrationSql = () => readMigration().replace(/--[^\n]*/g, '')

// ---------------------------------------------------------------------------
// Migration file
// ---------------------------------------------------------------------------

describe(`drizzle/${MIGRATION}`, () => {
  it('exists and is non-empty', () => {
    expect(readMigration().trim().length).toBeGreaterThan(0)
    expect(migrationSql().trim().length).toBeGreaterThan(0)
  })

  it('adds the column to orgs as plain nullable text', () => {
    expect(migrationSql()).toMatch(
      new RegExp(`ALTER TABLE\\s+orgs\\s+ADD COLUMN IF NOT EXISTS\\s+${COLUMN}\\s+text`, 'i')
    )
  })

  it('does not add NOT NULL, which would fail against every existing org row', () => {
    // Every org predates this column, so a NOT NULL without a default aborts
    // the migration on any populated database — and a NOT NULL *with* a default
    // would make "unrestricted" unrepresentable.
    expect(migrationSql()).not.toMatch(/NOT\s+NULL/i)
  })

  it('does not add a DEFAULT, so an unconfigured org stays NULL', () => {
    // NULL is the "unrestricted" sentinel the query layer writes and the origin
    // parser reads. A DEFAULT '' would silently turn every org into the empty
    // -allowlist case instead.
    expect(migrationSql()).not.toMatch(/\bDEFAULT\b/i)
  })

  it('is idempotent, because the runner replays a whole file after a partial failure', () => {
    // lib/db/migrate.ts only records a file in __custom_migrations after all of
    // its statements succeed. If a later statement in the same file throws, the
    // next deploy re-runs the file from the top, so every statement must be
    // replay-safe on its own.
    const statements = migrationSql()
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(statements.length).toBe(1)
    for (const stmt of statements) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i)
    }
  })

  it('touches only the orgs table', () => {
    // A migration that quietly altered a second table would be applied by the
    // runner with no review signal; keep the blast radius asserted.
    const tables = [...migrationSql().matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_]+)/gi)].map(
      (m) => m[1]
    )
    expect(tables).toEqual(['orgs'])
    expect(migrationSql()).not.toMatch(/\b(DROP|CREATE TABLE|TRUNCATE|UPDATE|DELETE)\b/i)
  })
})

// ---------------------------------------------------------------------------
// Migration runner pickup — lib/db/migrate.ts
// ---------------------------------------------------------------------------

describe('lib/db/migrate.ts picks the migration up', () => {
  const runner = () => readFileAt('lib/db/migrate.ts')

  it('is discovered by the runner glob: a .sql file directly in drizzle/', () => {
    // Mirrors the runner: readdir(drizzle) -> keep *.sql -> sort by filename.
    const files = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toContain(MIGRATION)
    expect(runner()).toContain("f.endsWith('.sql')")
    expect(runner()).toContain('.sort()')
  })

  it('sorts after every earlier migration, and after the one that creates orgs', () => {
    const files = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const idx = files.indexOf(MIGRATION)
    expect(files.slice(0, idx).every((f) => f < MIGRATION)).toBe(true)

    const orgsMigration = files.find((f) =>
      fs.readFileSync(path.join(DRIZZLE_DIR, f), 'utf-8').match(/CREATE TABLE (IF NOT EXISTS )?"?orgs"?/i)
    )
    expect(orgsMigration, 'no migration creates the orgs table').toBeDefined()
    // ALTER TABLE orgs against a database where orgs does not exist yet is a
    // hard failure, not an ALREADY_EXISTS skip.
    expect(orgsMigration! < MIGRATION).toBe(true)
  })

  it('has a unique numeric prefix, so ordering is deterministic', () => {
    const prefix = MIGRATION.slice(0, 4)
    const clashes = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql') && f.startsWith(prefix))
    expect(clashes).toEqual([MIGRATION])
  })

  it('survives the statement-breakpoint split it does not use', () => {
    // The runner splits on Drizzle's "--> statement-breakpoint" marker. This
    // file has none, so the whole file — leading comment block included — is
    // handed to a single sql.raw(). That only works because the comments are
    // line comments above the statement, not something that would strand a
    // trailing fragment.
    expect(runner()).toContain("content\n      .split('--> statement-breakpoint')")
    const chunks = readMigration()
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS/i)
  })

  it('treats "column already exists" as a skip, so a redeploy stays green', () => {
    // 42701 is what postgres raises for a duplicate ADD COLUMN. Belt-and-braces
    // with the IF NOT EXISTS above: a database migrated by hand before this file
    // shipped would otherwise throw and abort the whole boot.
    const src = runner()
    expect(src).toContain("'42701'")
    expect(src).toContain('ALREADY_EXISTS.has(code)')
    // Drizzle nests the postgres error, so the code has to be walked out of the
    // cause chain or the skip never fires.
    expect(src).toContain('pgErrorCode(e.cause)')
  })

  it('records the file so the second boot does not replay it', () => {
    const src = runner()
    expect(src).toContain('INSERT INTO __custom_migrations (filename) VALUES (${file})')
    expect(src).toContain('if (appliedSet.has(file)) continue')
  })

  it('is hand-written, so it must not be registered in the drizzle journal', () => {
    // migrate.ts exists precisely because journal-based migrate() skips these.
    // A stray journal entry would make drizzle-kit try to own the file too.
    const journal = JSON.parse(
      fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf-8')
    ) as { entries: { tag: string }[] }
    expect(journal.entries.map((e) => e.tag)).not.toContain(MIGRATION.replace('.sql', ''))
  })
})

// ---------------------------------------------------------------------------
// Schema <-> migration agreement, from real Drizzle metadata
// ---------------------------------------------------------------------------

describe('lib/db/schema: orgs.widgetAllowedOrigins matches the migration', () => {
  it('declares a nullable text column with the migration\'s column name', async () => {
    const { orgs } = await import('@/lib/db/schema')
    const col = getTableConfig(orgs).columns.find((c) => c.name === COLUMN)
    expect(col, `${COLUMN} missing from the Drizzle orgs table`).toBeDefined()
    // getSQLType() is the type Drizzle would emit — checking it rather than the
    // source text catches a column declared as varchar/json against a text SQL
    // column, which only blows up at runtime.
    expect(col!.getSQLType()).toBe('text')
    // Nullable is load-bearing: NULL is the "unrestricted" sentinel, and every
    // pre-migration row has it.
    expect(col!.notNull).toBe(false)
    expect(col!.hasDefault).toBe(false)
  })

  it('is reachable under the camelCase name the query layer uses', async () => {
    const { orgs } = await import('@/lib/db/schema')
    expect(orgs.widgetAllowedOrigins).toBeDefined()
    expect(orgs.widgetAllowedOrigins.name).toBe(COLUMN)
  })

  it('lives on the same table the migration alters', async () => {
    const { orgs } = await import('@/lib/db/schema')
    expect(getTableConfig(orgs).name).toBe('orgs')
  })

  it('adds no index or constraint the migration does not create', async () => {
    // The reverse of the usual drift: a schema-only index never reaches the
    // database, because drizzle-kit push is not part of this deploy path.
    const { orgs } = await import('@/lib/db/schema')
    const cfg = getTableConfig(orgs)
    const touching = [
      ...cfg.indexes.filter((i) =>
        i.config.columns.some((c) => (c as { name?: string }).name === COLUMN)
      ),
      ...cfg.uniqueConstraints.filter((u) => u.columns.some((c) => c.name === COLUMN)),
    ]
    expect(touching).toEqual([])
    expect(migrationSql()).not.toMatch(/CREATE (UNIQUE )?INDEX/i)
  })
})

// ---------------------------------------------------------------------------
// Query layer — compiled SQL, no connection
// ---------------------------------------------------------------------------

const { calls, rowsFor } = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  // Per-test canned result rows, keyed by a substring of the compiled SQL.
  // pg-proxy expects positional rows (arrays), matching the select order.
  rowsFor: [] as { match: string; rows: unknown[][] }[],
}))

// pg-proxy hands the compiled SQL and bound params to a callback instead of a
// socket, so the real query builders run with no database anywhere.
const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  const hit = rowsFor.find((r) => sql.includes(r.match))
  return { rows: hit ? hit.rows : [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

const queries = () => import('@/lib/db/queries/widgets')

describe('lib/db/queries/widgets: compiled SQL', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('setWidgetAllowedOrigins writes the newline-joined list, scoped to one org', async () => {
    const { setWidgetAllowedOrigins } = await queries()
    await setWidgetAllowedOrigins(42, ['example.com', 'docs.example.com'])

    expect(calls.length).toBe(1)
    const [q] = calls
    expect(q.sql).toContain('update "orgs" set')
    expect(q.sql).toContain(`"${COLUMN}" = $1`)
    // Without the id predicate this UPDATE rewrites every org's allowlist —
    // the single worst outcome available in this file.
    expect(q.sql).toMatch(/where "orgs"\."id" = \$2/)
    expect(q.params).toEqual(['example.com\ndocs.example.com', 42])
  })

  it('setWidgetAllowedOrigins stores NULL, not an empty string, when the list is cleared', async () => {
    const { setWidgetAllowedOrigins } = await queries()
    await setWidgetAllowedOrigins(42, [])

    const [q] = calls
    expect(q.params[0]).toBeNull()
    // '' is not NULL to postgres, and the two would have to be handled
    // separately everywhere downstream. NULL is the one sentinel.
    expect(q.params[0]).not.toBe('')
    expect(q.params[1]).toBe(42)
  })

  it('setWidgetAllowedOrigins touches no other column', async () => {
    const { setWidgetAllowedOrigins } = await queries()
    await setWidgetAllowedOrigins(42, ['example.com'])

    const setClause = calls[0].sql.slice(
      calls[0].sql.indexOf('set '),
      calls[0].sql.indexOf('where ')
    )
    // In particular it must not clear or rotate widget_token: saving a domain
    // list would then break every live embed.
    expect(setClause).not.toContain('widget_token')
    expect(setClause.match(/"[a-z_]+" = \$/g)).toEqual([`"${COLUMN}" = $`])
  })

  it('getWidgetAllowedOrigins reads one org and returns NULL as null', async () => {
    const { getWidgetAllowedOrigins } = await queries()
    rowsFor.push({ match: 'select', rows: [[null]] })
    const origins = await getWidgetAllowedOrigins(42)

    expect(origins).toBeNull()
    const [q] = calls
    expect(q.sql).toContain(`"${COLUMN}"`)
    expect(q.sql).toMatch(/where "orgs"\."id" = \$1/)
    // Drizzle binds the limit as a parameter too, hence the trailing 1.
    expect(q.sql).toContain('limit')
    expect(q.params).toEqual([42, 1])
  })

  it('getWidgetAllowedOrigins returns null rather than undefined for a missing org', async () => {
    const { getWidgetAllowedOrigins } = await queries()
    // No canned rows: the org does not exist.
    expect(await getWidgetAllowedOrigins(999)).toBeNull()
  })

  it('getWidgetAllowedOrigins round-trips the stored text unparsed', async () => {
    const { getWidgetAllowedOrigins } = await queries()
    rowsFor.push({ match: 'select', rows: [['example.com\nfoo.dev']] })
    // Parsing belongs to lib/widget/origin; the query layer must not "helpfully"
    // split or trim, or the Settings textarea stops round-tripping.
    expect(await getWidgetAllowedOrigins(42)).toBe('example.com\nfoo.dev')
  })

  it('getOrgByWidgetToken selects the allowlist column and returns it', async () => {
    const { getOrgByWidgetToken } = await queries()
    // Positional row, in select order: id, name, widget_token,
    // widget_token_expires_at, widget_allowed_origins,
    // widget_lead_capture_mode, plan_id.
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, 'example.com', 'on-failure', 'pro']],
    })

    const org = await getOrgByWidgetToken('tok-abc')

    const [q] = calls
    // If the column is not selected the iframe page has nothing to enforce
    // against and silently falls back to "not configured" for every org.
    expect(q.sql).toContain(`"orgs"."${COLUMN}"`)
    // Matched as a predicate fragment rather than anchored to `where ... = $1`:
    // the query now ANDs a deleted_at check alongside it, so anchoring made a
    // strictly more restrictive (and more correct) query look like a failure.
    expect(q.sql).toMatch(/"orgs"\."widget_token" = \$1/)
    // Still the only *bound* predicate value — deleted_at is null takes no
    // parameter — so the trailing 1 remains the bound limit.
    expect(q.params).toEqual(['tok-abc', 1])
    expect(org).toEqual({
      id: 7,
      name: 'Acme',
      widget_token: 'tok-abc',
      plan_id: 'pro',
      widget_allowed_origins: 'example.com',
      widget_lead_capture_mode: 'on-failure',
    })
  })

  it('getOrgByWidgetToken passes a NULL allowlist straight through', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({ match: 'select', rows: [[7, 'Acme', 'tok-abc', null, null, null]] })

    const org = await getOrgByWidgetToken('tok-abc')
    // null must survive as null — the caller distinguishes "no allowlist" from
    // "empty allowlist" only by this value.
    expect(org!.widget_allowed_origins).toBeNull()
    expect(org!.plan_id).toBe('none')
  })

  it('getOrgByWidgetToken still rejects an expired token before returning the allowlist', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', '2000-01-01T00:00:00.000Z', 'example.com', 'pro']],
    })
    expect(await getOrgByWidgetToken('tok-abc')).toBeNull()
  })

  it('every widgets query is scoped by a single-org predicate', async () => {
    const { getWidgetAllowedOrigins, setWidgetAllowedOrigins, ensureWidgetToken } = await queries()
    rowsFor.push({ match: 'select', rows: [[null]] })
    await getWidgetAllowedOrigins(42)
    await setWidgetAllowedOrigins(42, ['a.com'])
    await ensureWidgetToken(42)

    for (const c of calls) {
      expect(c.sql, c.sql).toMatch(/where "orgs"\."id" = \$\d/)
      expect(c.params, c.sql).toContain(42)
    }
  })
})

// ---------------------------------------------------------------------------
// public/widget.js — the embed loader
// ---------------------------------------------------------------------------

interface FakeElement {
  tag: string
  id: string
  src: string
  title: string
  innerHTML: string
  textContent: string
  attrs: Record<string, string>
  children: FakeElement[]
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  addEventListener(): void
  appendChild(c: FakeElement): void
  classList: { add(): void; remove(): void }
}

function makeElement(tag: string): FakeElement {
  const el: FakeElement = {
    tag,
    id: '',
    src: '',
    title: '',
    innerHTML: '',
    textContent: '',
    attrs: {},
    children: [],
    setAttribute(k, v) {
      el.attrs[k] = v
    },
    getAttribute(k) {
      return k in el.attrs ? el.attrs[k] : null
    },
    addEventListener() {},
    appendChild(c) {
      el.children.push(c)
    },
    classList: { add() {}, remove() {} },
  }
  return el
}

/**
 * Run public/widget.js against a stub DOM and return the iframe it built.
 * `origin` may be a string, null (absent), or the string 'throw' to simulate a
 * sandboxed frame where reading window.location.origin raises a SecurityError.
 */
function runWidgetScript(opts: { origin: string | null | 'throw'; widgetId?: string | null }) {
  const source = readFileAt('public/widget.js')

  const scriptEl = makeElement('script')
  scriptEl.attrs['data-base-url'] = 'https://app.answerloops.test'
  if (opts.widgetId !== null) scriptEl.attrs['data-widget-id'] = opts.widgetId ?? 'tok-abc'

  const head = makeElement('head')
  const body = makeElement('body')

  const location =
    opts.origin === 'throw'
      ? Object.defineProperty({} as { origin: string }, 'origin', {
          get() {
            throw new Error('SecurityError: blocked a frame with origin "null"')
          },
        })
      : { origin: opts.origin }

  const sandbox: Record<string, unknown> = {
    document: {
      currentScript: scriptEl,
      readyState: 'complete',
      head,
      body,
      createElement: (tag: string) => makeElement(tag),
      getElementsByTagName: () => [scriptEl],
      addEventListener: () => {},
    },
    location,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  const panel = body.children.find((c) => c.id === 'cp-widget-panel')
  return { panel, iframe: panel?.children.find((c) => c.tag === 'iframe'), body }
}

describe('public/widget.js: the iframe URL carries no caller-supplied origin', () => {
  const src = () => readFileAt('public/widget.js')

  it('puts only the token in the URL', () => {
    const s = src()
    expect(s).toContain("iframe.src = baseUrl + '/widget/' + widgetId;")
  })

  it('sends no parent parameter, keeping Referer the only origin signal', () => {
    const s = src().replace(/\/\/.*$/gm, '')
    expect(s).not.toContain('?parent=')
    expect(s).not.toContain('encodeURIComponent(parentOrigin)')
    expect(s).not.toContain('parentOrigin')
  })

  it('still no-ops without a widget id', () => {
    expect(src()).toContain("if (!widgetId) return;")
  })
})
