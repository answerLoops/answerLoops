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

describe('lib/actions/ai-config.ts — entitlement scope (save, test, list-models)', () => {
  const src = () => readSrc('lib/actions/ai-config.ts')
  const fnBody = (s: string, name: string) => {
    const idx = s.indexOf(`export async function ${name}`)
    expect(idx).toBeGreaterThan(-1)
    const next = s.indexOf('export async function', idx + 1)
    return s.slice(idx, next > -1 ? next : undefined)
  }

  it('the shared gate only requires the entitlement for an openai-compatible endpoint', () => {
    const s = src()
    const helperIdx = s.indexOf('async function customEndpointEntitlementError')
    expect(helperIdx).toBeGreaterThan(-1)
    const helper = s.slice(helperIdx, s.indexOf('/** Returns an error message when any given base URL', helperIdx))
    expect(helper).toContain("providers.includes('openai-compatible')")
    expect(helper).toContain("orgHasFeature(orgId, 'custom_ai_model_config')")
    // The only entitlement lookup in the file lives in this helper, behind the provider check.
    const occurrences = [...s.matchAll(/orgHasFeature\(orgId, 'custom_ai_model_config'\)/g)]
    expect(occurrences.length).toBe(1)
    expect(helper.indexOf("providers.includes('openai-compatible')")).toBeLessThan(
      helper.indexOf("orgHasFeature(orgId, 'custom_ai_model_config')")
    )
  })

  it.each(['saveAIConfigAction', 'testAIConfigAction', 'listModelsAction'])(
    '%s parses the form first, then applies the provider-scoped gate',
    (name) => {
      const body = fnBody(src(), name)
      const parseIdx = body.indexOf('.safeParse(Object.fromEntries(formData))')
      const gateIdx = body.indexOf('customEndpointEntitlementError(')
      expect(parseIdx).toBeGreaterThan(-1)
      expect(gateIdx).toBeGreaterThan(parseIdx)
    }
  )

  it('save and test gate on both providers; list-models gates on the chat provider it uses', () => {
    const s = src()
    expect(fnBody(s, 'saveAIConfigAction')).toContain('[d.chat_provider, d.embedding_provider]')
    expect(fnBody(s, 'testAIConfigAction')).toContain('[d.chat_provider, d.embedding_provider]')
    expect(fnBody(s, 'listModelsAction')).toContain('[d.chat_provider]')
  })

  it('the gate runs before any outbound call in test and list-models', () => {
    const s = src()
    const test = fnBody(s, 'testAIConfigAction')
    expect(test.indexOf('customEndpointEntitlementError(')).toBeLessThan(test.indexOf('testAIProviderConnection('))
    const list = fnBody(s, 'listModelsAction')
    expect(list.indexOf('customEndpointEntitlementError(')).toBeLessThan(list.indexOf('listModelsForProvider('))
  })

  it('save validates base URLs as public https before persisting', () => {
    const body = fnBody(src(), 'saveAIConfigAction')
    expect(body.indexOf('baseUrlError(')).toBeGreaterThan(-1)
    expect(body.indexOf('baseUrlError(')).toBeLessThan(body.indexOf('saveOrgAIConfig('))
  })
})
