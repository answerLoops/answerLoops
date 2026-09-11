import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Roadmap Known Issue: saveAIConfigAction gated the entire "Add AI key" save
// behind the Enterprise-only 'custom_ai_model_config' entitlement, blocking
// plain bring-your-own-key (OpenAI/Anthropic/Google/Groq/Mistral) on every
// plan below Enterprise — even though the pricing comparison table marks
// "Bring your own AI provider" as included on Standard and Pro too. Reported
// live by an org whose free-AI-trial banner told them to add a key, and the
// save silently rejected with an Enterprise-upsell error. Only an arbitrary
// custom endpoint ('openai-compatible', its own base URL) is the actually
// Enterprise-gated "Custom AI model configuration" row. Source-shape
// assertions, matching this repo's convention (see
// tests/unit/csv-export-entitlement.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('app/actions/ai-config.ts — saveAIConfigAction entitlement scope', () => {
  const src = () => readSrc('app/actions/ai-config.ts')

  it('parses the form before checking any entitlement, so provider choice can gate the check', () => {
    const s = src()
    const parseIdx = s.indexOf('SaveSchema.safeParse(Object.fromEntries(formData))')
    const gateIdx = s.indexOf("orgHasFeature(orgId, 'custom_ai_model_config')")
    expect(parseIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(parseIdx)
  })

  it('only requires the custom_ai_model_config entitlement for an openai-compatible endpoint', () => {
    const s = src()
    const isCustomIdx = s.indexOf('const isCustomEndpoint =')
    expect(isCustomIdx).toBeGreaterThan(-1)

    const isCustomLine = s.slice(isCustomIdx, s.indexOf('\n', isCustomIdx))
    expect(isCustomLine).toContain("d.chat_provider === 'openai-compatible'")
    expect(isCustomLine).toContain("d.embedding_provider === 'openai-compatible'")

    const gateIdx = s.indexOf("orgHasFeature(orgId, 'custom_ai_model_config')")
    const gateBlock = s.slice(isCustomIdx, gateIdx)
    expect(gateBlock).toContain('if (isCustomEndpoint &&')
  })

  it('never gates a named provider (openai/anthropic/google/groq/mistral) on the entitlement', () => {
    const s = src()
    // The only reference to the entitlement must be inside the
    // isCustomEndpoint-guarded branch — no unconditional early-return gate
    // above the parsed provider values.
    const occurrences = [...s.matchAll(/orgHasFeature\(orgId, 'custom_ai_model_config'\)/g)]
    expect(occurrences.length).toBe(1)
    const gateIdx = occurrences[0].index!
    const precedingCode = s.slice(0, gateIdx)
    expect(precedingCode).toContain('const isCustomEndpoint =')
  })
})
