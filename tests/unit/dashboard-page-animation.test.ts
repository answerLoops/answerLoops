import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Every dashboard page fades in with a small upward slide. Keeping the
// animation's last frame after it ends would leave a transform on the page,
// and any transform makes the page the box that position: fixed children are
// placed in. Pop-ups inside a page (the Automatic Deflections confirm, for
// one) would then be positioned against the scrolled page instead of the
// screen, and open partly off-screen. The entry animation may hold its first
// frame before it starts, but must hold nothing once it has finished.

const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf-8')

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} rule exists`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('the dashboard page entry animation', () => {
  it('still plays on every dashboard page', () => {
    expect(ruleBody('.dashboard-page')).toMatch(/animation:\s*dashboardEnter\b/)
  })

  it('leaves no transform behind once it ends', () => {
    const animation = ruleBody('.dashboard-page').match(/animation:([^;]+);/)?.[1] ?? ''
    expect(animation).not.toMatch(/\b(both|forwards)\b/)
    expect(animation).toMatch(/\bbackwards\b/)
  })
})
