import { describe, it, expect } from 'vitest'
import {
  listDocFolders,
  selectDocFiles,
  normalizeDocPaths,
  defaultSelection,
  isDocFile,
  ROOT_FOLDER,
  DEFAULT_DOC_FOLDERS,
  type TreeEntry,
} from '@/lib/github/doc-folders'

// The picker's folder list and the sync's file selection come from the same
// rule, so a count shown in the picker is exactly what a sync takes.

function tree(paths: string[]): TreeEntry[] {
  const dirs = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join('/'))
  }
  return [
    ...[...dirs].map((path) => ({ path, type: 'tree' as const, sha: `t-${path}` })),
    ...paths.map((path) => ({ path, type: 'blob' as const, sha: `b-${path}` })),
  ]
}

const byPath = (folders: ReturnType<typeof listDocFolders>) => Object.fromEntries(folders.map((f) => [f.path, f]))

describe('isDocFile', () => {
  it('accepts md, mdx and txt only when allowed', () => {
    expect(isDocFile('a/B.MD', { allowTxt: false })).toBe(true)
    expect(isDocFile('a/b.mdx', { allowTxt: false })).toBe(true)
    expect(isDocFile('a/b.txt', { allowTxt: false })).toBe(false)
    expect(isDocFile('a/b.txt', { allowTxt: true })).toBe(true)
    expect(isDocFile('a/b.ts', { allowTxt: true })).toBe(false)
  })
})

describe('listDocFolders', () => {
  it('counts docs recursively and leaves out folders with no docs', () => {
    const f = byPath(listDocFolders(tree(['docs/a.mdx', 'docs/api/b.md', 'src/x.ts', 'content/docs/c.txt'])))
    expect(f['docs']).toEqual({ path: 'docs', docFiles: 2, selectable: true })
    expect(f['docs/api'].docFiles).toBe(1)
    expect(f['src']).toBeUndefined()
    expect(f['content'].docFiles).toBe(1)
  })

  it('never offers hidden, dependency, build or test folders', () => {
    const t = tree([
      'README.md', 'docs/a.md', '.claude/commands/x.md', '.claude/CLAUDE.md', '.github/readme/a.md',
      '.cursor/rules/r.md', 'node_modules/pkg/readme.md', 'tests/fixtures/a.md', 'docs/.hidden/b.md',
      'vendor/lib/a.md', 'dist/a.md',
    ])
    expect(listDocFolders(t).map((f) => f.path)).toEqual(['.', 'docs'])
    expect(byPath(listDocFolders(t))['docs'].docFiles).toBe(1)
  })

  it('root counts only root files', () => {
    const folders = listDocFolders(tree(['README.md', 'docs/a.md']))
    expect(folders[0]).toEqual({ path: ROOT_FOLDER, docFiles: 1, selectable: true })
  })

  it('lists the root first, then folders by path', () => {
    expect(listDocFolders(tree(['top.md', 'z/a.md', 'b/c.md', 'b/a/x.md'])).map((f) => f.path)).toEqual(['.', 'b', 'b/a', 'z'])
  })
})

describe('selectDocFiles', () => {
  it('prefix match stops at a path boundary', () => {
    const { files } = selectDocFiles(tree(['docs/a.md', 'docs-old/a.md']), ['docs'])
    expect(files.map((f) => f.path)).toEqual(['docs/a.md'])
  })

  it('root folder takes only top-level files', () => {
    const { files } = selectDocFiles(tree(['README.md', 'docs/a.md']), [ROOT_FOLDER])
    expect(files.map((f) => f.path)).toEqual(['README.md'])
  })

  it('txt only inside chosen folders', () => {
    const entries = tree(['notes.txt', 'docs/x.txt', 'docs/a.md'])
    expect(selectDocFiles(entries, null).files.map((f) => f.path)).toEqual(['docs/a.md'])
    expect(selectDocFiles(entries, ['docs']).files.map((f) => f.path)).toEqual(['docs/a.md', 'docs/x.txt'])
  })

  it('legacy keeps exclusions with no cap', () => {
    const paths = Array.from({ length: 120 }, (_, k) => `guide/p${String(k).padStart(3, '0')}.md`)
    const { files } = selectDocFiles(tree([...paths, 'tests/t.md', 'CHANGELOG.md']), null)
    expect(files).toHaveLength(120)
    expect(files.some((f) => f.path === 'tests/t.md' || f.path === 'CHANGELOG.md')).toBe(false)
  })

  it('chosen folders have no cap', () => {
    const paths = Array.from({ length: 300 }, (_, k) => `docs/p${k}.mdx`)
    expect(selectDocFiles(tree(paths), ['docs']).files).toHaveLength(300)
  })

  it('reports missing folders', () => {
    expect(selectDocFiles(tree(['docs/a.md']), ['docs', 'guide']).missingFolders).toEqual(['guide'])
  })

  it('does not take a file twice', () => {
    expect(selectDocFiles(tree(['docs/a.md']), ['docs', 'docs']).files).toHaveLength(1)
  })
})

describe('normalizeDocPaths', () => {
  it('normalizes and rejects paths', () => {
    expect(normalizeDocPaths([' /docs/ ', 'docs/api', './guide'])).toEqual(['docs', 'guide'])
    expect(normalizeDocPaths(['../etc'])).toBeNull()
    expect(normalizeDocPaths(['a\\b'])).toBeNull()
    expect(normalizeDocPaths(['a\0b'])).toBeNull()
    expect(normalizeDocPaths([])).toBeNull()
    expect(normalizeDocPaths('docs')).toBeNull()
    expect(normalizeDocPaths([42])).toBeNull()
    expect(normalizeDocPaths(Array.from({ length: 51 }, (_, k) => `d${k}`))).toBeNull()
    expect(normalizeDocPaths(['x'.repeat(301)])).toBeNull()
  })

  it('keeps the root marker and treats it as its own folder', () => {
    expect(normalizeDocPaths(['.', 'docs'])).toEqual(['.', 'docs'])
    expect(normalizeDocPaths(['./', '/.'])).toEqual(['.'])
    expect(normalizeDocPaths(['.', 'docs/x'])).toEqual(['.', 'docs/x'])
    expect(normalizeDocPaths(['/'])).toBeNull()
  })

  it('rejects control characters and odd segments', () => {
    expect(normalizeDocPaths(['a\nb'])).toBeNull()
    expect(normalizeDocPaths(['a\u007fb'])).toBeNull()
    expect(normalizeDocPaths(['docs/./x'])).toBeNull()
    expect(normalizeDocPaths(['docs//x'])).toBeNull()
    expect(normalizeDocPaths(['...', '..foo'])).toBeNull()
  })

  it('refuses hidden and excluded folders', () => {
    expect(normalizeDocPaths(['.claude'])).toBeNull()
    expect(normalizeDocPaths(['.claude/commands'])).toBeNull()
    expect(normalizeDocPaths(['docs', '.github/readme'])).toBeNull()
    expect(normalizeDocPaths(['node_modules/pkg'])).toBeNull()
    expect(normalizeDocPaths(['docs/tests'])).toBeNull()
    expect(normalizeDocPaths(['docs', 'content/docs'])).toEqual(['docs', 'content/docs'])
  })
})

describe('selectDocFiles inside chosen folders', () => {
  it('skips hidden and excluded subfolders of a chosen folder, and of the root', () => {
    const t = tree(['docs/a.md', 'docs/.drafts/b.md', 'docs/tests/c.md', 'docs/node_modules/x/d.md', 'README.md'])
    expect(selectDocFiles(t, ['docs']).files.map((f) => f.path)).toEqual(['docs/a.md'])
    expect(selectDocFiles(t, ['.']).files.map((f) => f.path)).toEqual(['README.md'])
  })

  it('a saved hidden folder yields no files', () => {
    const t = tree(['.claude/commands/x.md', '.claude/CLAUDE.md'])
    expect(selectDocFiles(t, ['.claude']).files).toEqual([])
  })
})

describe('count matches selection', () => {
  it('every listed folder counts exactly the files a sync of that folder takes', () => {
    const t = tree(['README.md', 'a.TXT', 'Docs/A.MD', 'docs/b.Txt', 'docs/x/y.mdx', 'docs.md/x.md', 'src/z.ts'])
    for (const f of listDocFolders(t)) expect(selectDocFiles(t, [f.path]).files).toHaveLength(f.docFiles)
  })

  it('never reports the root, or a folder known only from its files, as missing', () => {
    const blobsOnly: TreeEntry[] = [{ path: 'guide/a.md', type: 'blob', sha: 's' }]
    expect(selectDocFiles(blobsOnly, ['.', 'guide']).missingFolders).toEqual([])
  })
})

describe('defaultSelection', () => {
  it('defaults pick existing docs folders', () => {
    expect(defaultSelection(listDocFolders(tree(['content/docs/a.mdx', 'website/x.md'])))).toEqual(['content/docs'])
  })

  it('skips a default folder with no docs files', () => {
    expect(defaultSelection(listDocFolders(tree(['docs/x.ts'])))).toEqual([])
  })

  it('names the five defaults', () => {
    expect(DEFAULT_DOC_FOLDERS).toEqual(['docs', 'content/docs', 'website/docs', 'apps/docs', 'documentation'])
  })
})
