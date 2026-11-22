import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The wiring behind workspace logos: the table and its migration, that deleting
 * a workspace removes the logo, that the image library is declared and kept out
 * of the browser, and which paths are public and which are not.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('the migration', () => {
  const sql = read('drizzle/0083_widget_logos.sql')
  const executable = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

  it('is the next one after the follow-up suggestions migration', () => {
    const files = fs.readdirSync(path.join(root, 'drizzle')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    expect(files.indexOf('0083_widget_logos.sql')).toBe(files.indexOf('0082_ticket_reply_transaction.sql') + 1)
  })

  it('creates one table, only if it is missing, so applying it twice is harmless', () => {
    expect(executable).toMatch(/CREATE TABLE IF NOT EXISTS widget_logos/)
    expect(executable.match(/CREATE TABLE/g)).toHaveLength(1)
  })

  it('keeps one row per workspace, tied to the workspace', () => {
    expect(executable).toMatch(/org_id INTEGER PRIMARY KEY REFERENCES orgs\(id\)/)
  })

  it('stores the small image, its type and its version', () => {
    expect(executable).toMatch(/content_type TEXT NOT NULL/)
    expect(executable).toMatch(/bytes BYTEA NOT NULL/)
    expect(executable).toMatch(/etag TEXT NOT NULL/)
    expect(executable).toMatch(/updated_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
  })

  it('changes nothing that already exists', () => {
    expect(executable).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER)\b/i)
  })
})

describe('the table in the schema', () => {
  const schema = read('lib/db/schema.ts')
  const block = schema.slice(schema.indexOf("pgTable('widget_logos'"))

  it('matches the migration', () => {
    expect(block).toMatch(/orgId: integer\('org_id'\)\.primaryKey\(\)\.references\(\(\) => orgs\.id\)/)
    expect(block).toMatch(/contentType: text\('content_type'\)\.notNull\(\)/)
    expect(block).toMatch(/bytes: bytea\('bytes'\)\.notNull\(\)/)
    expect(block).toMatch(/etag: text\('etag'\)\.notNull\(\)/)
  })
})

describe('the queries', () => {
  const queries = read('lib/db/queries/widget-logos.ts')

  it('replace a logo in place rather than adding a second', () => {
    expect(queries).toMatch(/onConflictDoUpdate\(\{\s*target: widgetLogos\.orgId/)
  })

  it('read the version without reading the image', () => {
    const version = queries.slice(queries.indexOf('getWidgetLogoVersion'), queries.indexOf('setWidgetLogo'))
    expect(version).toContain('etag: widgetLogos.etag')
    expect(version).not.toContain('bytes')
  })

  it('always scope by workspace', () => {
    expect(queries.match(/eq\(widgetLogos\.orgId, orgId\)/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('deleting a workspace', () => {
  it('removes its logo', () => {
    const orgs = read('lib/db/queries/orgs.ts')
    expect(orgs).toContain('widgetLogos,')
    expect(orgs).toContain('await tx.delete(widgetLogos).where(eq(widgetLogos.orgId, orgId))')
  })

  it('removes it before the workspace row itself', () => {
    const orgs = read('lib/db/queries/orgs.ts')
    expect(orgs.indexOf('tx.delete(widgetLogos)')).toBeLessThan(orgs.indexOf('tx.delete(orgs)'))
  })
})

describe('the image library', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }

  it('is declared as a direct dependency, within the range the workspace pins', () => {
    expect(pkg.dependencies.sharp).toBe('^0.35.5')
    expect(read('pnpm-workspace.yaml')).toMatch(/sharp: '>=0\.35\.5 <0\.36\.0'/)
  })

  it('is listed for the app in the lockfile', () => {
    const lock = read('pnpm-lock.yaml')
    const importer = lock.slice(lock.indexOf('importers:'), lock.indexOf('\npackages:'))
    expect(importer).toMatch(/\n {6}sharp:\n {8}specifier: '>=0\.35\.5 <0\.36\.0'\n {8}version: 0\.35\.5/)
  })

  it('stays out of the browser: no component imports the server-only image step', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (/\.(tsx?|jsx?)$/.test(entry.name) && /@\/lib\/images\/logo-pipeline|from 'sharp'/.test(read(rel))) offenders.push(rel)
      }
    }
    walk('components')
    expect(offenders).toEqual([])
  })

  it('the image step knows nothing about the chat widget or the database, so it can be reused', () => {
    const pipeline = read('lib/images/logo-pipeline.ts')
    expect(pipeline).not.toMatch(/from '@\/lib\/(widget|db|actions|billing)/)
    expect(pipeline).toMatch(/from 'sharp'/)
  })
})

describe('which paths are public', () => {
  const auth = read('auth.ts')
  const publicPaths = auth.slice(auth.indexOf('PUBLIC_PATHS'), auth.indexOf(']', auth.indexOf('PUBLIC_PATHS')))

  it('serves the logo from a path the chat and the launcher can reach without signing in', () => {
    expect(publicPaths).toContain("'/api/widget'")
  })

  it('keeps upload and removal behind sign-in: their path is not public', () => {
    expect(publicPaths).not.toContain('/api/settings')
    expect(fs.existsSync(path.join(root, 'app/api/settings/widget-logo/route.ts'))).toBe(true)
  })
})
