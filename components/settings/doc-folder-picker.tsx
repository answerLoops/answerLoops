'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { missingFolderLine } from '@/lib/github/sync-summary'

interface DocFolder {
  path: string
  docFiles: number
  selectable: boolean
}

interface FolderListing {
  folders: DocFolder[]
  selected: string[]
  usingDefaults: boolean
  missing: string[]
  truncated: boolean
}

const ROOT = '.'
const ROOT_LABEL = 'Repository root (top-level files only)'
/** Same limit the server applies (lib/github/doc-folders.ts). */
const MAX_FOLDERS = 50

/** The chosen folder that already includes this one, if any. The root only covers its own files. */
function coveringFolder(path: string, selected: Set<string>): string | null {
  if (path === ROOT) return null
  for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) {
    const parent = path.slice(0, at)
    if (selected.has(parent)) return parent
  }
  return null
}

/**
 * Lets an owner pick which folders of a connected repository feed the
 * knowledge base. The list comes from the repository itself, so only real
 * folders can be chosen; folders with no docs files are shown greyed out.
 * Saving switches Knowledge Base on for the repo with those folders.
 * `onSavingChange` lets the card lock its own controls while a save is out.
 */
export function DocFolderPicker({
  repoId,
  onSaved,
  onCancel,
  onSavingChange,
}: {
  repoId: number
  onSaved: () => void
  onCancel: () => void
  onSavingChange?: (saving: boolean) => void
}) {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const mounted = useRef(true)
  const headingRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    mounted.current = true
    headingRef.current?.focus()
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let live = true
    fetch(`/api/github/repos/${repoId}/doc-folders`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) {
          setLoadError(body.error ?? 'Could not read the repository. Try again shortly.')
          return
        }
        const data = body as FolderListing
        setListing(data)
        const gone = new Set(data.missing)
        setSelected(new Set(data.selected.filter((p) => !gone.has(p))))
      })
      .catch(() => {
        if (live) setLoadError('Could not read the repository. Try again shortly.')
      })
    return () => {
      live = false
    }
  }, [repoId])

  // Folders inside another chosen folder are already included by it.
  const chosen = useMemo(
    () => [...selected].filter((p) => coveringFolder(p, selected) === null).sort((a, b) => (a === ROOT ? -1 : b === ROOT ? 1 : a < b ? -1 : 1)),
    [selected]
  )
  const tooMany = chosen.length > MAX_FOLDERS

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    onSavingChange?.(true)
    setSaveError(null)
    let saved = false
    try {
      const res = await fetch('/api/github/repo-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId, kbEnabled: 1, kbPaths: chosen }),
      })
      if (res.ok) saved = true
      else if (mounted.current) {
        const body = await res.json().catch(() => ({}))
        setSaveError(body.error ?? 'Could not save the folders. Try again.')
      }
    } catch {
      if (mounted.current) setSaveError('Could not save the folders. Try again.')
    } finally {
      onSavingChange?.(false)
      if (mounted.current) setSaving(false)
    }
    // Closed while the save was out: the person has moved on, so don't act on it.
    if (saved && mounted.current) onSaved()
  }

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-white p-3 space-y-3">
      <div>
        <p ref={headingRef} tabIndex={-1} id={`doc-folders-${repoId}`} className="text-sm font-medium text-gray-800 outline-none">
          Docs folders
        </p>
        <p className="text-xs text-gray-500">
          Choose the folders that hold your docs. Every .md, .mdx and .txt file inside them, including subfolders, is synced.
        </p>
      </div>

      {loadError ? (
        <p className="text-xs text-red-600" role="alert">{loadError}</p>
      ) : !listing ? (
        <p className="text-xs text-gray-500" role="status">Loading folders…</p>
      ) : (
        <>
          {listing.truncated && <p className="text-xs text-amber-700">This repository is too large to list every folder.</p>}
          {listing.missing.map((folder) => (
            <p key={folder} className="text-xs text-amber-700 break-words">{missingFolderLine(folder)}</p>
          ))}
          <ul
            role="group"
            aria-labelledby={`doc-folders-${repoId}`}
            className="max-h-[50vh] sm:max-h-72 overflow-y-auto rounded border border-gray-100 divide-y divide-gray-50"
          >
            {listing.folders.map((folder) => {
              const coveredBy = coveringFolder(folder.path, selected)
              const checked = selected.has(folder.path) || coveredBy !== null
              const disabled = coveredBy !== null || (!folder.selectable && !selected.has(folder.path))
              const depth = folder.path === ROOT ? 0 : folder.path.split('/').length - 1
              const label = folder.path === ROOT ? ROOT_LABEL : folder.path
              return (
                <li key={folder.path} style={{ paddingLeft: `${0.5 + Math.min(depth, 4) * 0.5}rem` }} className="pr-2 py-2.5 sm:py-1.5">
                  <label
                    className={`flex items-start gap-2 text-xs ${disabled && !coveredBy ? 'text-gray-400' : 'text-gray-700'} ${disabled ? '' : 'cursor-pointer'}`}
                    title={coveredBy ? `Included through ${coveredBy}` : undefined}
                  >
                    <input
                      type="checkbox"
                      className="rounded shrink-0 mt-0.5"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(folder.path)}
                    />
                    <span className="min-w-0 flex-1 break-all font-mono">
                      {label}
                      {coveredBy && <span className="ml-1 font-sans text-gray-400">(included)</span>}
                    </span>
                    <span className="shrink-0 text-gray-400">{folder.docFiles === 1 ? '1 file' : `${folder.docFiles} files`}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          {tooMany && <p className="text-xs text-amber-700">Choose up to {MAX_FOLDERS} folders.</p>}
        </>
      )}

      {saveError && <p className="text-xs text-red-600" role="alert">{saveError}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        {!loadError && (
          <Button size="sm" onClick={save} disabled={!listing || chosen.length === 0 || tooMany || saving}>
            {saving ? 'Saving…' : 'Save and sync'}
          </Button>
        )}
      </div>
    </div>
  )
}
