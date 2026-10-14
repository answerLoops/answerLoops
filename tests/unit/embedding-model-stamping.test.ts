import { describe, it, expect } from 'vitest'
import fs from 'fs'

// Every stored vector records the model that actually produced it, and
// similarity search only compares vectors from the workspace's pinned model.
// Without both, a model change mixes two vector spaces in one score and
// search quietly returns poor matches.

const read = (f: string) => fs.readFileSync(f, 'utf-8')

describe('stored vectors record the model that made them', () => {
  it.each([
    'app/api/kb/upload/route.ts', 'lib/ingest/url.ts', 'lib/notion/kb-sync.ts',
    'lib/github/kb-sync.ts', 'lib/actions/kb.ts', 'lib/ingest/pipeline.ts',
  ])('%s uses embedTextWithModel and no longer stamps EMBEDDING_MODEL', (f) => {
    const s = read(f)
    expect(s).toContain('embedTextWithModel(')
    expect(s).not.toMatch(/model:\s*EMBEDDING_MODEL|saveEmbedding\([^)]*EMBEDDING_MODEL/)
  })

  it('lib/github/kb-sync.ts stamps all three of its write sites', () => {
    expect(read('lib/github/kb-sync.ts').match(/embedTextWithModel\(/g)?.length).toBe(3)
  })
})

describe('rewriting a vector discards anything the re-embed job staged for that row', () => {
  // Otherwise an article edited after staging (its text changed, vector
  // rewritten) gets the stale staged vector copied over it at the switch.
  const fnBody = (src: string, name: string) => {
    const start = src.indexOf(`export async function ${name}`)
    return src.slice(start, src.indexOf('\n}\n', start))
  }

  it.each(['createArticle', 'upsertArticleFromSource'])('kb.ts %s clears the staged columns when it updates a row', (name) => {
    const body = fnBody(read('lib/db/queries/kb.ts'), name)
    expect(body).toMatch(/embeddingNext: null/)
    expect(body).toMatch(/embeddingVecNext: null/)
    expect(body).toMatch(/modelNext: null/)
  })

  it('saveEmbedding clears the staged ticket vector on conflict', () => {
    const body = fnBody(read('lib/db/queries/embeddings.ts'), 'saveEmbedding')
    const set = body.slice(body.indexOf('onConflictDoUpdate'))
    expect(set).toMatch(/vectorNext: null/)
    expect(set).toMatch(/modelNext: null/)
  })
})

describe('search only compares vectors on the workspace pin', () => {
  it('searchArticles filters kb_articles.model by the org pin', () => {
    const s = read('lib/db/queries/kb.ts')
    const fn = s.slice(s.indexOf('export async function searchArticles'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/kbArticles\.model[\s\S]*embedding_model_in_use/)
  })

  it('getCandidateVectors filters ticket_embeddings.model by the org pin', () => {
    const s = read('lib/db/queries/embeddings.ts')
    const fn = s.slice(s.indexOf('export async function getCandidateVectors'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/ticketEmbeddings\.model[\s\S]*embedding_model_in_use/)
  })

  it('the widget query cache key includes the model', () => {
    expect(read('lib/widget/embed-cache.ts')).toMatch(/keyFor\(orgId, [a-zA-Z]+, query\)/)
  })
})
