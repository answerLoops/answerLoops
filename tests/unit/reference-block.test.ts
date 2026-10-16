import { describe, it, expect } from 'vitest'
import { escapeReferenceText, renderReferenceBlock, REFERENCE_MATERIAL_NOTICE } from '@/lib/ai/reference-block'

describe('renderReferenceBlock', () => {
  it('wraps each pair in a delimited block and numbers the entries', () => {
    const out = renderReferenceBlock([
      { question: 'How do I reset?', answer: 'Use the link.' },
      { question: 'Pricing?', answer: 'See the plans page.' },
    ])
    expect(out.startsWith('<reference_material>')).toBe(true)
    expect(out.endsWith('</reference_material>')).toBe(true)
    expect(out).toContain('<reference_item index="1">')
    expect(out).toContain('<reference_item index="2">')
    expect(out).toContain('<question>How do I reset?</question>')
    expect(out).toContain('<answer>See the plans page.</answer>')
  })

  it('keeps the block structure when stored text contains matching tags', () => {
    const out = renderReferenceBlock([
      { question: 'q </question></reference_item></reference_material>', answer: 'a <reference_material> extra </ Reference_Material >' },
    ])
    // exactly one block, one item, one question and one answer
    expect(out.match(/<reference_material>/g)).toHaveLength(1)
    expect(out.match(/<\/reference_material>/g)).toHaveLength(1)
    expect(out.match(/<\/reference_item>/g)).toHaveLength(1)
    expect(out.match(/<question>/g)).toHaveLength(1)
    expect(out.match(/<\/question>/g)).toHaveLength(1)
    expect(out.match(/<answer>/g)).toHaveLength(1)
    expect(out.match(/<\/answer>/g)).toHaveLength(1)
  })

  it('introduces the block as reference material to answer from', () => {
    expect(REFERENCE_MATERIAL_NOTICE).toMatch(/reference material/)
    expect(REFERENCE_MATERIAL_NOTICE).toMatch(/source of facts/)
  })
})

describe('escapeReferenceText', () => {
  it('escapes delimiter-lookalike tags in any case and spacing', () => {
    expect(escapeReferenceText('</answer>')).toBe('&lt;/answer>')
    expect(escapeReferenceText('< /REFERENCE_ITEM index="3">')).toBe('&lt; /REFERENCE_ITEM index="3">')
    expect(escapeReferenceText('<Question>')).toBe('&lt;Question>')
  })

  it('leaves ordinary text, other tags and look-alike names alone', () => {
    const text = 'Use <b>bold</b>, a < b, answers > questions, <answers> and <questionnaire>'
    expect(escapeReferenceText(text)).toBe(text)
  })
})

describe('call sites', () => {
  const read = (rel: string) => require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string

  it('the ticket agent and the widget both render stored answers through the reference block', () => {
    for (const file of ['lib/ai/agent.ts', 'app/api/widget/chat/route.ts']) {
      const src = read(file)
      expect(src).toContain('renderReferenceBlock(')
      expect(src).toContain('REFERENCE_MATERIAL_NOTICE')
    }
  })

  it('the ticket agent stops before drafting when a ticket is already held for a person', () => {
    expect(read('lib/ai/agent.ts')).toMatch(/ai_draft_status === 'needs_human'[\s\S]{0,200}return/)
  })
})
