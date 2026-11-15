import type { KBArticle } from '@/types'

/** A saved resolution is an article written from a ticket. */
export function isResolution(a: Pick<KBArticle, 'source_ticket_id'>): boolean {
  return a.source_ticket_id != null
}

export type ArticleSortOrder = 'newest' | 'oldest'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long ago something was saved, in the coarse units a reviewer scans for
 * ("3 months ago"). Returns null for a date that does not parse.
 */
export function describeAge(iso: string, now: number = Date.now()): string | null {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const days = Math.floor((now - then) / DAY_MS)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  if (days < 365) {
    const months = Math.floor(days / 30)
    return months === 1 ? '1 month ago' : `${months} months ago`
  }
  const years = Math.floor(days / 365)
  return years === 1 ? '1 year ago' : `${years} years ago`
}

/**
 * Orders by when the article was last saved. Rows with an unreadable date sort
 * last in either direction, so they never hide behind the ones that can be read.
 * Returns a new array; the input is not changed.
 */
export function sortBySaved<T extends Pick<KBArticle, 'updated_at'>>(articles: T[], order: ArticleSortOrder): T[] {
  const time = (a: T) => {
    const t = Date.parse(a.updated_at)
    return Number.isNaN(t) ? null : t
  }
  return [...articles].sort((a, b) => {
    const ta = time(a)
    const tb = time(b)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return order === 'oldest' ? ta - tb : tb - ta
  })
}
