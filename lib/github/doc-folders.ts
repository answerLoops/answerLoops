/**
 * Which files in a repository feed the knowledge base.
 *
 * An owner picks docs folders from a list built from the repository's own
 * tree (listDocFolders), so a misspelt or non-existent folder can't be chosen.
 * The counts that list shows and the files a sync takes (selectDocFiles) use
 * the same rule, so the picker never promises a file the sync then skips.
 *
 * A repository with no folders chosen keeps the original rule: every `.md`
 * and `.mdx` file in the repository, minus test, vendor and housekeeping
 * files. Neither path has a file cap; the knowledge base's article limit is
 * the only bound.
 */

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  /** Bytes, for blobs. */
  size?: number
}

/** The blobs and folders of a recursive git tree from the GitHub API. */
export function toTreeEntries(items: Array<{ path?: string; type?: string; sha?: string; size?: number }> | undefined): TreeEntry[] {
  const out: TreeEntry[] = []
  for (const item of items ?? []) {
    if (!item.path || !item.sha || (item.type !== 'blob' && item.type !== 'tree')) continue
    out.push({ path: item.path, type: item.type, sha: item.sha, ...(item.size !== undefined && { size: item.size }) })
  }
  return out
}

export interface DocFolder {
  /** Folder path, or ROOT_FOLDER for files at the top of the repository. */
  path: string
  /** Docs files inside, counting subfolders. The root counts only its own files. */
  docFiles: number
  selectable: boolean
}

/** Stands for the files directly in the repository root, not its subfolders. */
export const ROOT_FOLDER = '.'

/** Folders ticked by default when they exist and hold docs files. */
export const DEFAULT_DOC_FOLDERS = ['docs', 'content/docs', 'website/docs', 'apps/docs', 'documentation']

/** Larger files are skipped by a sync without being downloaded. */
export const MAX_DOC_FILE_BYTES = 1_048_576

const MAX_CHOSEN_FOLDERS = 50
const MAX_FOLDER_PATH_LENGTH = 300

const EXCLUDE_PATHS = ['node_modules', 'vendor', '.github', 'test', 'tests', '__tests__', 'spec']

/**
 * Folders nobody wants in a knowledge base: hidden folders (`.claude`,
 * `.github`, `.cursor`, ...), dependencies, build output and test folders.
 * They are left out of the picker, refused when saved, and skipped by a sync
 * even inside a chosen folder, so an agent-instruction or CI file is never
 * uploaded by accident.
 */
const NEVER_SYNC_SEGMENTS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', 'target', 'bower_components',
  'test', 'tests', '__tests__', 'spec', '__snapshots__', '__mocks__', '__pycache__',
])

export function isExcludedFolder(path: string): boolean {
  if (path === ROOT_FOLDER) return false
  return path.split('/').some((seg) => seg.startsWith('.') || NEVER_SYNC_SEGMENTS.has(seg.toLowerCase()))
}

/** True when the file sits inside a hidden or excluded folder. */
function inExcludedFolder(filePath: string): boolean {
  const slash = filePath.lastIndexOf('/')
  return slash !== -1 && isExcludedFolder(filePath.slice(0, slash))
}
const EXCLUDE_FILES = ['CHANGELOG.md', 'CHANGELOG.mdx', 'LICENSE.md', 'CODE_OF_CONDUCT.md']

export function isDocFile(path: string, opts: { allowTxt: boolean }): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.mdx') || (opts.allowTxt && lower.endsWith('.txt'))
}

/** The rule for a repository with no folders chosen. */
function shouldIncludeLegacy(path: string): boolean {
  if (!isDocFile(path, { allowTxt: false })) return false
  const lower = path.toLowerCase()
  for (const excl of EXCLUDE_PATHS) {
    if (lower.includes(`/${excl}/`) || lower.startsWith(`${excl}/`)) return false
  }
  const filename = path.split('/').pop() ?? ''
  return !EXCLUDE_FILES.includes(filename)
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? ROOT_FOLDER : path.slice(0, slash)
}

function inFolder(path: string, folder: string): boolean {
  return folder === ROOT_FOLDER ? !path.includes('/') : path.startsWith(`${folder}/`)
}

/**
 * The folders worth offering, with their docs file counts: the root first,
 * then by path. Hidden and excluded folders, and folders with no docs files
 * anywhere inside, are left out.
 */
export function listDocFolders(entries: TreeEntry[]): DocFolder[] {
  const counts = new Map<string, number>([[ROOT_FOLDER, 0]])
  const ensure = (dir: string) => {
    if (!counts.has(dir)) counts.set(dir, 0)
  }
  for (const e of entries) {
    if (e.type === 'tree') ensure(e.path)
  }
  for (const e of entries) {
    if (e.type !== 'blob') continue
    const parts = e.path.split('/')
    for (let k = 1; k < parts.length; k++) ensure(parts.slice(0, k).join('/'))
    if (!isDocFile(e.path, { allowTxt: true }) || inExcludedFolder(e.path)) continue
    if (parts.length === 1) {
      counts.set(ROOT_FOLDER, counts.get(ROOT_FOLDER)! + 1)
      continue
    }
    for (let k = 1; k < parts.length; k++) {
      const dir = parts.slice(0, k).join('/')
      counts.set(dir, counts.get(dir)! + 1)
    }
  }
  return [...counts.entries()]
    .filter(([path, docFiles]) => docFiles > 0 && !isExcludedFolder(path))
    .sort(([a], [b]) => (a === ROOT_FOLDER ? -1 : b === ROOT_FOLDER ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map(([path, docFiles]) => ({ path, docFiles, selectable: true }))
}

export function defaultSelection(folders: DocFolder[]): string[] {
  const selectable = new Set(folders.filter((f) => f.selectable).map((f) => f.path))
  return DEFAULT_DOC_FOLDERS.filter((d) => selectable.has(d))
}

function hasControlCharacter(text: string): boolean {
  for (let k = 0; k < text.length; k++) {
    const code = text.charCodeAt(k)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Cleans a list of chosen folders, or returns null when it can't be used:
 * not a list of strings, empty, too long, or a path that climbs out of the
 * repository. Leading `./` and surrounding slashes are trimmed, duplicates
 * dropped, and a folder inside another chosen folder is dropped because the
 * outer one already takes it. ROOT_FOLDER is kept as its own choice.
 */
export function normalizeDocPaths(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CHOSEN_FOLDERS) return null
  const cleaned: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.length > MAX_FOLDER_PATH_LENGTH) return null
    if (raw.includes('\\') || hasControlCharacter(raw)) return null
    const trimmed = raw.trim()
    if (/^[./]+$/.test(trimmed) && trimmed.includes('.') && !trimmed.includes('..')) {
      cleaned.push(ROOT_FOLDER)
      continue
    }
    const path = trimmed.replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '')
    if (!path || path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null
    if (isExcludedFolder(path)) return null
    cleaned.push(path)
  }
  const unique = [...new Set(cleaned)]
  return unique.filter((p) => p === ROOT_FOLDER || !unique.some((other) => other !== ROOT_FOLDER && other !== p && p.startsWith(`${other}/`)))
}

/**
 * The files a sync takes, sorted by path, and the chosen folders that no
 * longer exist in the tree. `kbPaths` null means no folders were chosen.
 */
export function selectDocFiles(entries: TreeEntry[], kbPaths: string[] | null): { files: TreeEntry[]; missingFolders: string[] } {
  const blobs = entries.filter((e) => e.type === 'blob')
  const byPath = (a: TreeEntry, b: TreeEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

  if (kbPaths === null) {
    return { files: blobs.filter((e) => shouldIncludeLegacy(e.path)).sort(byPath), missingFolders: [] }
  }

  const dirs = new Set<string>()
  for (const e of entries) {
    if (e.type === 'tree') dirs.add(e.path)
    else for (let dir = parentOf(e.path); dir !== ROOT_FOLDER; dir = parentOf(dir)) dirs.add(dir)
  }
  const missingFolders = kbPaths.filter((p) => p !== ROOT_FOLDER && !dirs.has(p))
  const files = blobs
    .filter((e) => isDocFile(e.path, { allowTxt: true }) && !inExcludedFolder(e.path) && kbPaths.some((folder) => inFolder(e.path, folder)))
    .sort(byPath)
  return { files, missingFolders }
}
