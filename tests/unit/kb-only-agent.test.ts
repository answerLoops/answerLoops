import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// KB-only agent mode. Orgs with no GitHub repos configured previously got no
// AI answers at all on Discord/Slack/Telegram/Email — runAIAgent returned
// early before generating anything, even when KB context and prior resolved
// answers were available. The agent must now run without code-search tools in
// that case, grounded on prior answers only, with an explicit no-hallucination
// instruction (the confidence reviewer still gates auto-deflection).
//
// Source-file structural assertions — same convention as tenant-isolation.test.ts.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('AI agent runs in KB-only mode when no GitHub repos configured', () => {
  it('no longer returns early when the org has zero repos', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).not.toContain('skipping agent')
    expect(src).toContain('KB-only mode')
    // The zero-repo branch must not bail before supportAgent.generate
    const kbOnlyIdx = src.indexOf('KB-only mode')
    const generateIdx = src.indexOf('supportAgent.generate(')
    expect(kbOnlyIdx).toBeGreaterThan(-1)
    expect(generateIdx).toBeGreaterThan(kbOnlyIdx)
  })

  it('attaches code-search tools only when repos exist', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toMatch(/tools\s*=\s*hasCodeSearch\s*\?/)
    expect(src).toContain(': undefined')
  })

  it('KB-only prompt forbids inventing project-specific details', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain('Do not invent project-specific details')
    expect(src).toContain('say honestly that a team member will follow up')
  })

  it('both modes still feed the drafted answer to the confidence reviewer', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain('assessAnswer(question, text, orgId)')
    expect(src).toContain('shouldAutoDeflect(assessment, threshold)')
  })
})
