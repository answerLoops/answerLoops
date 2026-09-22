import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// listModelsAction (lib/actions/ai-config.ts) — the live model-list source for
// Settings → AI Model's "Refresh models" button. Same requireOrgAccess/parse
// structure as testAIConfigAction and saveAIConfigAction in this file, so
// covered the same way this repo tests server actions that depend on session
// context: source-shape assertions rather than full execution mocking (see
// tests/unit/ai-config-byok-entitlement.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/actions/ai-config.ts — listModelsAction', () => {
  const src = () => readSrc('lib/actions/ai-config.ts')

  it('exports listModelsAction and requires owner/admin org access, same as save/test', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function listModelsAction')
    expect(fnIdx).toBeGreaterThan(-1)
    const nextFnIdx = s.indexOf('export async function', fnIdx + 1)
    const body = s.slice(fnIdx, nextFnIdx > -1 ? nextFnIdx : undefined)
    expect(body).toContain('resolveOrgForAIConfig()')
    expect(body).toContain('if (!access.ok) return { error: access.error }')
  })

  it('resolves the API key with the same fallback order as testAIConfigAction: typed value, then the saved one', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function listModelsAction')
    const body = s.slice(fnIdx)
    expect(body).toContain('d.chat_api_key || existing?.chat_api_key || null')
  })

  it('requires a key before calling out, except for openai-compatible (which may be keyless/local)', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function listModelsAction')
    const body = s.slice(fnIdx)
    const guardIdx = body.indexOf("if (!apiKey && d.chat_provider !== 'openai-compatible')")
    expect(guardIdx).toBeGreaterThan(-1)
  })

  it('dispatches to listModelsForProvider and never persists anything (no save/update DB call)', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function listModelsAction')
    const nextFnIdx = s.indexOf('export async function', fnIdx + 1)
    const body = s.slice(fnIdx, nextFnIdx > -1 ? nextFnIdx : undefined)
    expect(body).toContain('listModelsForProvider(d.chat_provider, apiKey')
    expect(body).not.toMatch(/saveOrgAIConfig|deleteOrgAIConfig/)
  })

  it('caps and sanitizes upstream error messages before returning them to the client', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function listModelsAction')
    const body = s.slice(fnIdx)
    const catchIdx = body.indexOf('} catch (err) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBlock = body.slice(catchIdx, catchIdx + 500)
    expect(catchBlock).toMatch(/\.slice\(0, 200\)/)
  })

  it('includes xai in the shared CHAT_PROVIDERS enum used by every action in this file', () => {
    const s = src()
    const enumIdx = s.indexOf('const CHAT_PROVIDERS =')
    const enumLine = s.slice(enumIdx, s.indexOf('\n', enumIdx))
    expect(enumLine).toContain("'xai'")
  })
})
