import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-level wiring for the widget's starter questions: the migration, the
 * schema, the query layer, the action, the settings screen, the chat panel page
 * and the public lookup all have to agree. A missing link fails quietly (a
 * column that is saved but never shown) rather than loudly.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('migration 0079', () => {
  const sql = read('drizzle/0079_widget_starter_questions.sql')

  it('adds the nullable questions and switch columns, so every existing widget keeps its look', () => {
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_starter_questions TEXT;/)
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_starter_enabled BOOLEAN;/)
    expect(sql).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/DEFAULT/)
  })

  it('can be applied twice, so a re-run of the migrations is harmless', () => {
    expect((sql.match(/IF NOT EXISTS/g) ?? []).length).toBe(2)
  })

  it('has a number nothing else uses', () => {
    const same = fs.readdirSync(path.join(process.cwd(), 'drizzle')).filter((f) => f.startsWith('0079_'))
    expect(same).toEqual(['0079_widget_starter_questions.sql'])
  })
})

describe('schema and queries', () => {
  it('declares the column with the same name as the migration', () => {
    const schema = read('lib/db/schema.ts')
    expect(schema).toContain("widgetStarterQuestions: text('widget_starter_questions')")
    expect(schema).toContain("widgetStarterEnabled: boolean('widget_starter_enabled')")
  })

  it('selects it for the workspace the token resolves to and for Settings, and reads it defensively', () => {
    const queries = read('lib/db/queries/widgets.ts')
    expect(queries).toContain('widget_starter_questions: orgs.widgetStarterQuestions')
    expect(queries).toContain('starterQuestions: orgs.widgetStarterQuestions')
    expect(queries).toContain('widget_starter_enabled: orgs.widgetStarterEnabled')
    expect(queries).toContain('serializeStarterQuestions(')
    expect(queries).toContain('serializeStarterEnabled(')
  })
})

describe('the action', () => {
  const actions = read('lib/actions/widget.ts')

  it('cleans the questions from the form and names the field when they are refused', () => {
    expect(actions).toContain("normalizeStarterQuestions(formData.get('starterQuestions'))")
    expect(actions).toContain("field: 'starterQuestions'")
  })

  it('still checks the plan on the server before saving or resetting', () => {
    const save = actions.slice(actions.indexOf('export async function saveWidgetAppearanceAction'))
    expect(save.indexOf("orgHasFeature(access.orgId, 'white_label_widget')")).toBeLessThan(
      save.indexOf('normalizeStarterQuestions')
    )
  })
})

describe('the chat panel and the public lookup', () => {
  it('gives the panel the questions only where the plan includes customization', () => {
    const page = read('app/widget/[widgetToken]/page.tsx')
    expect(page).toContain('const appearance = whiteLabel ? org.widget_appearance : null')
    expect(page).toContain('starterQuestions={appearance?.starterEnabled ? appearance.starterQuestions : []}')
  })

  it('never puts them in the public, cached lookup the embed script reads', () => {
    const route = read('app/api/widget/config/route.ts')
    expect(route).not.toContain('starterQuestions')
    expect(route).not.toContain('starterEnabled')
    expect(read('lib/widget/display-settings.ts')).not.toContain('starterQuestions')
    expect(read('public/widget.js')).not.toContain('starterQuestions')
  })
})

describe('Settings', () => {
  it('re-creates the form when the saved questions change, so the box shows what was stored', () => {
    const page = read('app/(dashboard)/settings/page.tsx')
    expect(page).toContain("appearance.starterQuestions.join('|')")
    expect(page).toContain('appearance.starterEnabled')
  })
})
