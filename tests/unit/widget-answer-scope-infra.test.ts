import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-level wiring for the widget answer scope and guidance note: the
 * migration, the schema, the chat route and Settings all have to agree, and a
 * missing link fails quietly (a column that is never read, a prompt that never
 * uses the setting) rather than loudly.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('migration 0077', () => {
  const sql = read('drizzle/0077_widget_answer_scope.sql')

  it('adds the scope column defaulting existing workspaces to the old behaviour', () => {
    expect(sql).toMatch(
      /ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_answer_scope TEXT NOT NULL DEFAULT 'general';/,
    )
  })

  it('adds a nullable guidance column', () => {
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_guidance TEXT;/)
    expect(sql).not.toMatch(/widget_guidance TEXT NOT NULL/)
  })

  it('can be applied twice, so a re-run of the migrations is harmless', () => {
    expect((sql.match(/IF NOT EXISTS/g) ?? []).length).toBe(2)
  })

  it('has a number nothing else uses', () => {
    const same = fs.readdirSync(path.join(process.cwd(), 'drizzle')).filter((f) => f.startsWith('0077_'))
    expect(same).toEqual(['0077_widget_answer_scope.sql'])
  })
})

describe('schema', () => {
  const schema = read('lib/db/schema.ts')

  it('declares both columns with the same names and default as the migration', () => {
    expect(schema).toContain("widgetAnswerScope: text('widget_answer_scope').notNull().default('general')")
    expect(schema).toContain("widgetGuidance: text('widget_guidance')")
  })
})

describe('the chat route', () => {
  const route = read('app/api/widget/chat/route.ts')

  it('builds the instructions through buildWidgetInstructions, from the resolved workspace', () => {
    expect(route).toMatch(/import \{ buildWidgetInstructions(, widgetContextBlock)? \} from '@\/lib\/widget\/instructions'/)
    expect(route).toMatch(/answerScope: org\.widget_answer_scope/)
    expect(route).toMatch(/guidance: org\.widget_guidance/)
  })

  it('no longer carries its own copy of the instruction text', () => {
    expect(route).not.toContain('You are a helpful support assistant for')
    expect(route).not.toContain('answer from general knowledge')
  })

  // That nothing in a request can set the scope or the note is asserted by what
  // the route does, in widget-chat-answer-scope.test.ts, not by searching its source.
})

describe('the query layer', () => {
  const queries = read('lib/db/queries/widgets.ts')

  it('selects both columns for the org the token resolves to', () => {
    expect(queries).toContain('widget_answer_scope: orgs.widgetAnswerScope')
    expect(queries).toContain('widget_guidance: orgs.widgetGuidance')
  })

  it('reads an unrecognised scope as the narrower one', () => {
    expect(queries).toContain('SAFE_WIDGET_ANSWER_SCOPE_FALLBACK')
  })
})

describe('Settings', () => {
  it('shows the controls inside the widget section, fed by what was loaded', () => {
    const page = read('app/(dashboard)/settings/page.tsx')
    expect(page).toContain("import { WidgetAnswersSettings } from '@/components/settings/widget-answers'")
    expect(page).toContain('<WidgetAnswersSettings')
    expect(page).toContain('if (result.answerScope) setAnswerScope(result.answerScope)')
  })
})
