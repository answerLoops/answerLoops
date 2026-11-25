import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const VS_DIR = path.join(process.cwd(), 'app/vs')
const slugs = fs
  .readdirSync(VS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

describe('comparison page social cards', () => {
  it('finds the comparison pages', () => {
    expect(slugs.length).toBeGreaterThanOrEqual(10)
  })

  it.each(slugs)('/vs/%s has its own card instead of the generic site card', (slug) => {
    const file = path.join(VS_DIR, slug, 'opengraph-image.tsx')
    expect(fs.existsSync(file), `${slug} is missing opengraph-image.tsx`).toBe(true)
    const src = fs.readFileSync(file, 'utf-8')
    // Decided per request: a self-hosted install must 404, and the deployment
    // mode is a runtime setting, so the card can never be prerendered.
    expect(src).toContain("export const dynamic = 'force-dynamic'")
    expect(src).toContain('renderVsCover(')
    expect(src).toMatch(/export const alt = 'answerLoops vs /)
  })

  it('the bold font and its licence ship with the repo', () => {
    const dir = path.join(process.cwd(), 'lib/marketing/fonts')
    expect(fs.statSync(path.join(dir, 'Geist-Bold.ttf')).size).toBeGreaterThan(10_000)
    expect(fs.readFileSync(path.join(dir, 'Geist-OFL.txt'), 'utf-8')).toContain('SIL Open Font License')
  })

  it('returns a 404 on a self-hosted install', async () => {
    vi.resetModules()
    vi.doMock('@/lib/site', () => ({ marketingSiteEnabled: () => false }))
    const { renderVsCover } = await import('@/lib/marketing/vs-cover')
    const res = await renderVsCover('Olark', ['Channels'])
    expect(res.status).toBe(404)
    vi.doUnmock('@/lib/site')
  })
})
