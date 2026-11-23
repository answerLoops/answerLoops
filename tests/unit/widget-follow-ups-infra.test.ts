import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-level wiring for suggested follow-up questions: the migration, the
 * schema, the query layer, the action, the settings screen, the chat route and
 * the panel all have to agree. A missing link fails quietly (a switch that
 * saves but changes nothing) rather than loudly.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('migration 0081', () => {
  const sql = read('drizzle/0081_widget_follow_up_suggestions.sql')

  it('adds one nullable switch column, so every existing widget behaves as it did', () => {
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_follow_ups_enabled BOOLEAN;/)
    expect(sql).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/DEFAULT/)
  })

  it('can be applied twice, so a re-run of the migrations is harmless', () => {
    expect((sql.match(/IF NOT EXISTS/g) ?? []).length).toBe(1)
  })

  it('is the only file with its number', () => {
    const same = fs.readdirSync(path.join(process.cwd(), 'drizzle')).filter((f) => f.startsWith('0081_'))
    expect(same).toEqual(['0081_widget_follow_up_suggestions.sql'])
  })
})

describe('schema and queries', () => {
  it('declares the column with the same name as the migration', () => {
    expect(read('lib/db/schema.ts')).toContain("widgetFollowUpsEnabled: boolean('widget_follow_ups_enabled')")
  })

  it('selects it for the workspace the token resolves to and for Settings, and writes it', () => {
    const queries = read('lib/db/queries/widgets.ts')
    expect(queries).toContain('widget_follow_ups_enabled: orgs.widgetFollowUpsEnabled')
    expect(queries).toContain('followUpsEnabled: orgs.widgetFollowUpsEnabled')
    expect(queries).toContain('serializeFollowUpsEnabled(')
  })
})

describe('the action and the settings screen', () => {
  it('reads the switch from the form and puts it back to on on reset, behind the same plan check', () => {
    const actions = read('lib/actions/widget.ts')
    expect(actions).toContain("readFollowUpsEnabled(formData.get('followUpsEnabled'))")
    expect(actions).toContain('followUpsEnabled: true')
    const save = actions.slice(actions.indexOf('export async function saveWidgetAppearanceAction'))
    expect(save.indexOf("orgHasFeature(access.orgId, 'white_label_widget')")).toBeLessThan(save.indexOf('setWidgetAppearance('))
  })

  it('has the control, sends it with Save, and re-mounts when it changes', () => {
    const component = read('components/settings/widget-appearance.tsx')
    expect(component).toContain('Suggest follow-up questions')
    expect(component).toContain("fd.set('followUpsEnabled'")
    expect(read('app/(dashboard)/settings/page.tsx')).toContain('${appearance.followUpsEnabled}')
  })
})

describe('the chat route and the panel', () => {
  it('registers the tool and tells the assistant only when the plan and the switch allow it', () => {
    const route = read('app/api/widget/chat/route.ts')
    expect(route).toContain('followUpsAvailable(')
    expect(route).toContain('followUps,\n')
    expect(route).toMatch(/buildGenuiTools\(\s*\(\) => turn\.groundedText\(\),\s*followUps \? \{ followUps: \{ ground:/)
  })

  it('draws the card from the live-suggestion rule and clears it on typing', () => {
    const panel = read('app/widget/[widgetToken]/widget-chat.tsx')
    expect(panel).toContain('latestFollowUpCallId(messages)')
    expect(panel).toContain("input.trim() === ''")
    expect(panel).toContain('restoredFollowUpIds.has(')
    expect(panel).toContain('GENUI_TOOL_NAMES.followUps')
  })

  it('keeps database imports out of the instructions module', () => {
    expect(read('lib/widget/instructions.ts')).not.toMatch(/from '@\/lib\/(db|billing)/)
    expect(read('lib/widget/genui-tools.ts')).not.toMatch(/from '@\/lib\/(db|billing)/)
  })
})
