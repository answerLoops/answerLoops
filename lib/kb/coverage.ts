/**
 * What the chat assistant is able to answer from, shaped for the "Knowledge
 * coverage" view.
 *
 * Pure grouping logic, kept apart from the database query
 * (lib/db/queries/kb-coverage.ts) so the rules for what counts as "live" can be
 * tested without a database. Those rules mirror retrieval exactly: the widget
 * only ever sees an article that is published AND has a vector embedding (see
 * searchArticles in lib/db/queries/kb.ts). An article that is missing either is
 * listed here with the reason, rather than silently left out — the point of the
 * view is that nobody is surprised by what the assistant does or doesn't know.
 */

export type CoverageStatus = 'live' | 'unpublished' | 'not_searchable'

export interface CoverageRow {
  id: number
  title: string
  published: number
  searchable: boolean
  sourceId: number | null
  sourceTicketId: number | null
  sourceName: string | null
  sourceType: string | null
}

export interface CoverageItem {
  id: number
  title: string
  status: CoverageStatus
}

export type CoverageGroupKind = 'source' | 'tickets' | 'manual'

export interface CoverageGroup {
  key: string
  kind: CoverageGroupKind
  label: string
  /** file_type of the source (pdf, md, url, ...), when the group is a source. */
  sourceType: string | null
  total: number
  live: number
  items: CoverageItem[]
}

export interface Coverage {
  summary: {
    total: number
    live: number
    unpublished: number
    notSearchable: number
    sources: number
  }
  groups: CoverageGroup[]
  /** True when the org has more articles than were loaded. */
  truncated: boolean
}

/** Upper bound on articles loaded for the view; keeps the payload bounded. */
export const COVERAGE_MAX_ARTICLES = 2000

const MAX_TITLE_CHARS = 300

export function statusOf(row: Pick<CoverageRow, 'published' | 'searchable'>): CoverageStatus {
  if (row.published !== 1) return 'unpublished'
  return row.searchable ? 'live' : 'not_searchable'
}

export function buildCoverage(rows: CoverageRow[], truncated = false): Coverage {
  const groups = new Map<string, CoverageGroup>()

  const groupFor = (row: CoverageRow): CoverageGroup => {
    let key: string
    let kind: CoverageGroupKind
    let label: string
    let sourceType: string | null = null

    if (row.sourceId !== null) {
      key = `source:${row.sourceId}`
      kind = 'source'
      // The source row can be gone while its articles remain; say so instead of
      // showing a blank heading.
      label = row.sourceName ?? `Removed source #${row.sourceId}`
      sourceType = row.sourceType
    } else if (row.sourceTicketId !== null) {
      key = 'tickets'
      kind = 'tickets'
      label = 'Promoted from resolved tickets'
    } else {
      key = 'manual'
      kind = 'manual'
      label = 'Added by hand'
    }

    let group = groups.get(key)
    if (!group) {
      group = { key, kind, label, sourceType, total: 0, live: 0, items: [] }
      groups.set(key, group)
    }
    return group
  }

  let live = 0
  let unpublished = 0
  let notSearchable = 0

  for (const row of rows) {
    const status = statusOf(row)
    const group = groupFor(row)
    group.items.push({ id: row.id, title: row.title.slice(0, MAX_TITLE_CHARS), status })
    group.total += 1
    if (status === 'live') {
      group.live += 1
      live += 1
    } else if (status === 'unpublished') {
      unpublished += 1
    } else {
      notSearchable += 1
    }
  }

  const kindOrder: Record<CoverageGroupKind, number> = { source: 0, tickets: 1, manual: 2 }
  const ordered = [...groups.values()].sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.live - a.live || a.label.localeCompare(b.label)
  )
  for (const g of ordered) {
    g.items.sort((a, b) => a.title.localeCompare(b.title))
  }

  return {
    summary: {
      total: rows.length,
      live,
      unpublished,
      notSearchable,
      sources: ordered.filter((g) => g.kind === 'source').length,
    },
    groups: ordered,
    truncated,
  }
}
