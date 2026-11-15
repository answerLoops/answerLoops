import type { ReferenceEntry } from '@/lib/ai/reference-block'

/**
 * A draft written with GitHub code search is grounded in what the search and
 * file-read tools returned, not only in the knowledge base. This keeps those
 * outputs so the grading step can check the draft against them as well.
 *
 * Failed lookups are skipped: an error string is not evidence for anything.
 */

const DEFAULT_PER_ENTRY_CHARS = 3000

interface SearchHit {
  path: string
  fragment?: string
}

function isSearchHits(value: unknown): value is SearchHit[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'object' && v !== null && typeof (v as SearchHit).path === 'string')
}

export function createEvidenceCollector(options: { perEntryChars?: number } = {}) {
  const perEntryChars = options.perEntryChars ?? DEFAULT_PER_ENTRY_CHARS
  const items: ReferenceEntry[] = []

  const cap = (text: string) =>
    text.length > perEntryChars ? `${text.slice(0, perEntryChars)}\n... (truncated)` : text

  return {
    recordFile(repo: string, path: string, result: unknown) {
      if (typeof result !== 'string' || result === '') return
      items.push({ question: `File ${repo}:${path}`, answer: cap(result) })
    },
    recordSearch(repo: string, query: string, result: unknown) {
      if (!isSearchHits(result) || result.length === 0) return
      const body = result.map((hit) => (hit.fragment ? `${hit.path}: ${hit.fragment}` : hit.path)).join('\n')
      items.push({ question: `Search "${query}" in ${repo}`, answer: cap(body) })
    },
    entries(): ReferenceEntry[] {
      return [...items]
    },
  }
}
