import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-level wiring for the widget appearance settings: the migration, the
 * schema, the query layer, the actions, the settings screen, the chat panel and
 * the config lookup all have to agree. A missing link fails quietly (a column
 * that is never read, a color that is saved but never shown) rather than loudly.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('migration 0078', () => {
  const sql = read('drizzle/0078_widget_appearance.sql')

  it('adds the three nullable text columns, so every existing widget keeps its look', () => {
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_title TEXT;/)
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_welcome TEXT;/)
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_brand_color TEXT;/)
    expect(sql).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/DEFAULT/)
  })

  it('can be applied twice, so a re-run of the migrations is harmless', () => {
    expect((sql.match(/IF NOT EXISTS/g) ?? []).length).toBe(3)
  })

  it('has a number nothing else uses', () => {
    const same = fs.readdirSync(path.join(process.cwd(), 'drizzle')).filter((f) => f.startsWith('0078_'))
    expect(same).toEqual(['0078_widget_appearance.sql'])
  })
})

describe('schema', () => {
  const schema = read('lib/db/schema.ts')

  it('declares the columns with the same names as the migration', () => {
    expect(schema).toContain("widgetTitle: text('widget_title')")
    expect(schema).toContain("widgetWelcome: text('widget_welcome')")
    expect(schema).toContain("widgetBrandColor: text('widget_brand_color')")
  })
})

describe('the query layer', () => {
  const queries = read('lib/db/queries/widgets.ts')

  it('selects the three columns for the workspace the token resolves to and reads them defensively', () => {
    expect(queries).toContain('widget_title: orgs.widgetTitle')
    expect(queries).toContain('widget_welcome: orgs.widgetWelcome')
    expect(queries).toContain('widget_brand_color: orgs.widgetBrandColor')
    expect(queries).toContain('readWidgetAppearance(')
  })
})

describe('the actions', () => {
  const actions = read('lib/actions/widget.ts')

  it('check the plan on the server before saving or resetting', () => {
    const save = actions.slice(actions.indexOf('export async function saveWidgetAppearanceAction'))
    expect(save).toContain("orgHasFeature(access.orgId, 'white_label_widget')")
    const reset = actions.slice(actions.indexOf('export async function resetWidgetAppearanceAction'))
    expect(reset).toContain("orgHasFeature(access.orgId, 'white_label_widget')")
  })

  it('report the saved values and whether the plan includes customization to Settings', () => {
    expect(actions).toContain('appearance,')
    expect(actions).toContain('customizationAvailable,')
  })
})

describe('Settings', () => {
  it('shows the appearance controls inside the widget section, fed by what was loaded', () => {
    const page = read('app/(dashboard)/settings/page.tsx')
    expect(page).toContain("import { WidgetAppearanceSettings } from '@/components/settings/widget-appearance'")
    expect(page).toContain('<WidgetAppearanceSettings')
    expect(page).toContain('setAppearance(result.appearance ?? EMPTY_WIDGET_APPEARANCE)')
    expect(page).toContain('setCustomizationAvailable(result.customizationAvailable === true)')
  })
})

describe('the chat panel page', () => {
  it('applies the owner’s choices only where the plan includes customization', () => {
    const page = read('app/widget/[widgetToken]/page.tsx')
    expect(page).toContain('const appearance = whiteLabel ? org.widget_appearance : null')
    expect(page).toContain('brandPalette(appearance.brandColor)')
  })

  it('has no text-white left on a brand background, so the readable color always applies', () => {
    for (const file of ['app/widget/[widgetToken]/widget-chat.tsx', 'app/widget/[widgetToken]/genui-cards.tsx']) {
      const offenders = read(file)
        .split('\n')
        .filter((line) => line.includes('bg-brand-600') && line.includes('text-white'))
      expect(offenders, file).toEqual([])
    }
    expect(read('app/globals.css')).toMatch(/\.text-on-brand\s*\{\s*color: var\(--brand-on, #ffffff\);/)
  })
})

describe('the config lookup', () => {
  it('passes the stored brand color through the plan-limiting resolver', () => {
    const route = read('app/api/widget/config/route.ts')
    expect(route).toContain('org.widget_appearance.brandColor')
    expect(route).toContain('resolveWidgetDisplay(')
    expect(route).not.toContain('org.widget_appearance.title')
    expect(route).not.toContain('org.widget_appearance.welcome')
  })
})
