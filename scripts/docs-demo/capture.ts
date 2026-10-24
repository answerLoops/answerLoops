/**
 * Captures documentation screenshots of the real app running against the
 * seeded demo workspace, and writes a manifest of annotated regions ("pins")
 * for the docs components to draw numbered markers on.
 *
 * Usage (app and database running as described in README.md):
 *   pnpm docs:shots                     all shots
 *   pnpm docs:shots dashboard billing   only these shot ids
 *   pnpm docs:shots --preview           also write pin overlays to scripts/docs-demo/.tmp/pins/
 *
 * Environment:
 *   DOCS_BASE_URL   defaults to http://localhost:3112
 *
 * Outputs:
 *   public/docs/shots/<id>.webp
 *   lib/docs/shots.generated.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, type Browser, type Page, type Locator } from '@playwright/test'
import {
  DEFAULT_TEXT_MASKS,
  DEFAULT_VIEWPORT,
  SHOTS,
  type Shot,
  type ShotMask,
  type TextMaskRule,
} from './shots.manifest'

const ROOT = path.resolve(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'public', 'docs', 'shots')
const JSON_PATH = path.join(ROOT, 'lib', 'docs', 'shots.generated.json')
const PREVIEW_DIR = path.join(__dirname, '.tmp', 'pins')
const STORAGE_STATE_PATH = path.join(__dirname, '.tmp', 'storage-state.json') // written by session.ts
const BASE_URL = (process.env.DOCS_BASE_URL ?? 'http://localhost:3112').replace(/\/$/, '')

const MAX_WIDTH = 1600
const TARGET_BYTES = 250 * 1024
const DEVICE_SCALE_FACTOR = 2
const NAV_TIMEOUT_MS = 120_000
const SELECTOR_TIMEOUT_MS = 20_000

// `sharp` ships with Next.js (image optimisation) but is not a direct
// dependency of this repo, so resolve it from next's own location.
// Only the calls this script makes are typed, because the package's own types
// are not resolvable from the repo root either.
interface SharpImage {
  metadata(): Promise<{ width?: number; height?: number }>
  resize(options: { width: number; withoutEnlargement?: boolean }): SharpImage
  webp(options: { quality: number; effort: number }): SharpImage
  png(): SharpImage
  composite(layers: Array<{ input: Buffer }>): SharpImage
  toFile(file: string): Promise<unknown>
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }>
}
type Sharp = (input: Buffer) => SharpImage

function loadSharp(): Sharp {
  const fromNext = createRequire(require.resolve('next/package.json'))
  return fromNext('sharp') as Sharp
}

interface PinOut {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}
interface ShotOut {
  src: string
  width: number
  height: number
  alt: string
  pins: PinOut[]
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch (err) {
    console.warn(
      `[docs-shots] Chrome unavailable (${(err as Error).message.split('\n')[0]}); falling back to bundled chromium`,
    )
    return await chromium.launch()
  }
}

// Hide dev-only chrome, the product feedback widget, toasts and animations.
function pageStyles(): string {
  return `
    nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], [data-next-badge-root],
    [data-sonner-toaster], [role="alert"][data-toast], .Toastify { display: none !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  `
}

async function applyMasks(page: Page, masks: ShotMask[], rules: TextMaskRule[]): Promise<void> {
  for (const mask of masks) {
    const count = await page.locator(mask.selector).count()
    if (count === 0) throw new Error(`mask selector matched nothing: ${mask.selector}`)
    await page.locator(mask.selector).evaluateAll(
      (els, m) => {
        for (const el of els as HTMLElement[]) {
          if (m.mode === 'blur') el.style.filter = 'blur(6px)'
          else el.textContent = m.text ?? '••••••••'
        }
      },
      { mode: mask.mode, text: mask.text },
    )
  }
  await page.evaluate((list) => {
    const compiled = list.map((r) => ({ re: new RegExp(r.pattern, r.flags ?? 'g'), to: r.replacement }))
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    for (const node of nodes) {
      let value = node.nodeValue ?? ''
      for (const { re, to } of compiled) value = value.replace(re, to)
      if (value !== node.nodeValue) node.nodeValue = value
    }
    // Inputs and the embed snippet textarea carry values, not text nodes.
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>) {
      let value = el.value
      for (const { re, to } of compiled) value = value.replace(re, to)
      if (value !== el.value) el.value = value
    }
  }, rules.map((r) => ({ ...r, flags: r.flags ?? 'g' })))
}

// Last line of defence: nothing secret-looking or non-fictional may remain.
async function assertSafe(page: Page, shotId: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const text = document.body.innerText + '\n' + Array.from(document.querySelectorAll('input, textarea')).map((e) => (e as HTMLInputElement).value).join('\n')
    const found: string[] = []
    if (/[•·]{2,}\s?[A-Za-z0-9]{4}\b/.test(text)) found.push('a masked-token tail (last four characters)')
    if (/\b[0-9a-f]{24,}\b/.test(text)) found.push('a long hex value')
    if (/\bal_live_[0-9a-f]{4,}/.test(text)) found.push('an API key prefix')
    if (/\beyJ[A-Za-z0-9_-]{10,}/.test(text)) found.push('a token-shaped string')
    for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
      if (!/@([a-z0-9-]+\.)*example\.(com|org)$/i.test(m)) found.push(`a non-fictional email address (${m.replace(/^[^@]*/, '***')})`)
    }
    return found
  })
  if (problems.length) throw new Error(`[${shotId}] unsafe content on screen: ${problems.join('; ')}`)
}

async function runShot(browser: Browser, shot: Shot, preview: boolean, sharp: Sharp): Promise<ShotOut> {
  const viewport = shot.viewport ?? DEFAULT_VIEWPORT
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(SELECTOR_TIMEOUT_MS)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().split('\n')[0].slice(0, 200))
    })
    page.on('pageerror', (e) => consoleErrors.push(`uncaught: ${e.message.slice(0, 200)}`))
    const response = await page.goto(`${BASE_URL}${shot.route}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS })
    const status = response?.status() ?? 0
    const finalPath = new URL(page.url()).pathname
    if (status === 404) throw new Error(`[${shot.id}] ${shot.route} returned 404`)
    if (status >= 400) throw new Error(`[${shot.id}] ${shot.route} returned HTTP ${status}`)
    if (finalPath.startsWith('/login')) {
      throw new Error(`[${shot.id}] redirected to /login: the session is missing or expired. Run \`pnpm docs:session\` again.`)
    }

    await page.addStyleTag({ content: pageStyles() })
    if (!shot.keepFeedbackWidget) {
      // The floating product-feedback button is the only fixed-position button labelled "Feedback".
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll('button')) as HTMLElement[]) {
          if (getComputedStyle(el).position === 'fixed' && /feedback/i.test(el.textContent ?? '')) el.style.display = 'none'
        }
      })
    }
    for (const selector of shot.waitFor) await page.locator(selector).first().waitFor({ state: 'visible' })

    for (const action of shot.actions ?? []) {
      if ('click' in action) await page.locator(action.click).first().click()
      else if ('fill' in action) await page.locator(action.fill).first().fill(action.value)
      else if ('scrollTo' in action) {
        // The dashboard scrolls inside <main>, not the window: put the element 90px below the top edge.
        await page.locator(action.scrollTo).first().evaluate((el) => {
          const scroller = el.closest('main') as HTMLElement | null
          if (!scroller) return
          scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24
        })
      }
      else await page.locator(action.waitFor).first().waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForLoadState('networkidle')
    }

    await page.evaluate(() => document.fonts.ready)
    await applyMasks(page, shot.mask ?? [], [...DEFAULT_TEXT_MASKS, ...(shot.textMask ?? [])])
    await assertSafe(page, shot.id)
    await page.waitForTimeout(400)

    if (consoleErrors.length) {
      throw new Error(`[${shot.id}] console errors on ${shot.route}:\n  ${consoleErrors.join('\n  ')}`)
    }
    const stillBlank = await page.locator('[class*="animate-pulse"], [aria-busy="true"]').count()
    if (stillBlank > 0) throw new Error(`[${shot.id}] loading skeletons still on screen`)

    // Capture area, in viewport CSS pixels.
    const capture = shot.capture ?? { type: 'viewport' as const }
    let area: { x: number; y: number; width: number; height: number }
    if (capture.type === 'viewport') {
      area = { x: 0, y: 0, width: viewport.width, height: viewport.height }
    } else if (capture.type === 'clip') {
      area = { x: capture.x, y: capture.y, width: capture.width, height: capture.height }
    } else {
      const box = await page.locator(capture.selector).first().boundingBox()
      if (!box) throw new Error(`[${shot.id}] capture element has no box: ${capture.selector}`)
      area = box
    }

    const pins: PinOut[] = []
    for (const pin of shot.pins) {
      const locator: Locator = page.locator(pin.selector).first()
      try {
        await locator.waitFor({ state: 'visible', timeout: 5_000 })
      } catch {
        throw new Error(`[${shot.id}] pin "${pin.id}" selector matched no visible element: ${pin.selector}`)
      }
      const box = await locator.boundingBox()
      if (!box) throw new Error(`[${shot.id}] pin "${pin.id}" has no bounding box`)
      const x0 = clamp(box.x - area.x, 0, area.width)
      const y0 = clamp(box.y - area.y, 0, area.height)
      const x1 = clamp(box.x + box.width - area.x, 0, area.width)
      const y1 = clamp(box.y + box.height - area.y, 0, area.height)
      if (x1 - x0 < 1 || y1 - y0 < 1) {
        throw new Error(`[${shot.id}] pin "${pin.id}" lies outside the captured area`)
      }
      pins.push({
        id: pin.id,
        label: pin.label,
        x: round1((x0 / area.width) * 100),
        y: round1((y0 / area.height) * 100),
        w: round1(((x1 - x0) / area.width) * 100),
        h: round1(((y1 - y0) / area.height) * 100),
      })
    }

    const png = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      clip: area,
      fullPage: false,
    })

    // Encode: at most 1600px wide, stepping quality down to fit the size budget.
    const meta = await sharp(png).metadata()
    const targetWidth = Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH)
    let webp: Buffer = Buffer.alloc(0)
    let outInfo = { width: 0, height: 0 }
    for (const quality of [88, 82, 76, 70, 62, 55]) {
      const { data, info } = await sharp(png)
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality, effort: 6 })
        .toBuffer({ resolveWithObject: true })
      webp = data
      outInfo = { width: info.width, height: info.height }
      if (data.length <= TARGET_BYTES) break
    }
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUT_DIR, `${shot.id}.webp`), webp)

    if (preview) {
      fs.mkdirSync(PREVIEW_DIR, { recursive: true })
      const rects = pins
        .map((p, i) => {
          const x = (p.x / 100) * outInfo.width
          const y = (p.y / 100) * outInfo.height
          const w = (p.w / 100) * outInfo.width
          const h = (p.h / 100) * outInfo.height
          return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#e11d48" stroke-width="3"/>` +
            `<circle cx="${x}" cy="${y}" r="16" fill="#e11d48"/><text x="${x}" y="${y + 6}" font-size="18" fill="#fff" text-anchor="middle" font-family="sans-serif">${i + 1}</text>`
        })
        .join('')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outInfo.width}" height="${outInfo.height}">${rects}</svg>`
      await sharp(webp).composite([{ input: Buffer.from(svg) }]).png().toFile(path.join(PREVIEW_DIR, `${shot.id}.png`))
    }

    console.log(`[docs-shots] ${shot.id}: ${outInfo.width}x${outInfo.height}, ${(webp.length / 1024).toFixed(0)} KB, ${pins.length} pins`)
    return { src: `/docs/shots/${shot.id}.webp`, width: outInfo.width, height: outInfo.height, alt: shot.alt, pins }
  } finally {
    await context.close()
  }
}

function validateManifest(): void {
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/
  const seen = new Set<string>()
  for (const shot of SHOTS) {
    if (!kebab.test(shot.id)) throw new Error(`shot id is not kebab-case: ${shot.id}`)
    if (seen.has(shot.id)) throw new Error(`duplicate shot id: ${shot.id}`)
    seen.add(shot.id)
    const pinIds = new Set<string>()
    for (const pin of shot.pins) {
      if (!kebab.test(pin.id)) throw new Error(`[${shot.id}] pin id is not kebab-case: ${pin.id}`)
      if (pinIds.has(pin.id)) throw new Error(`[${shot.id}] duplicate pin id: ${pin.id}`)
      pinIds.add(pin.id)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const preview = args.includes('--preview')
  const ids = args.filter((a) => !a.startsWith('--'))

  validateManifest()
  const unknown = ids.filter((id) => !SHOTS.some((s) => s.id === id))
  if (unknown.length) {
    throw new Error(`unknown shot id(s): ${unknown.join(', ')}. Known: ${SHOTS.map((s) => s.id).join(', ')}`)
  }
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error('No saved session. Run `pnpm docs:session` first (see scripts/docs-demo/README.md).')
  }

  const selected = ids.length ? SHOTS.filter((s) => ids.includes(s.id)) : SHOTS
  const sharp = loadSharp()
  const browser = await launchBrowser()
  const results: Record<string, ShotOut> = {}
  const failures: string[] = []
  try {
    for (const shot of selected) {
      // The dev server compiles routes on first visit, which can surface a
      // one-off console error. A failure must repeat to count.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          results[shot.id] = await runShot(browser, shot, preview, sharp)
          break
        } catch (err) {
          const raw = (err as Error).message
          const message = raw.startsWith('[') ? raw : `[${shot.id}] ${raw.split('\n')[0]}`
          if (attempt === 1) {
            console.warn(`[docs-shots] retrying after: ${message}`)
            continue
          }
          failures.push(message)
          console.error(`[docs-shots] FAILED ${message}`)
        }
      }
    }
  } finally {
    await browser.close()
  }

  // Merge into the existing file so a single-shot run keeps the others.
  let existing: Record<string, ShotOut> = {}
  if (fs.existsSync(JSON_PATH)) existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  const known = new Set(SHOTS.map((s) => s.id))
  const merged: Record<string, ShotOut> = {}
  for (const id of [...Object.keys({ ...existing, ...results })].filter((id) => known.has(id)).sort()) {
    merged[id] = results[id] ?? existing[id]
  }
  fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true })
  fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + '\n')

  if (failures.length) {
    console.error(`\n[docs-shots] ${failures.length} shot(s) failed.`)
    process.exit(1)
  }
  console.log(`[docs-shots] wrote ${Object.keys(results).length} shot(s); manifest at lib/docs/shots.generated.json`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
