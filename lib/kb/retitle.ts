import { sectionTitle } from '@/lib/ingest/url'

/**
 * Titles for sections imported from a web page before titles carried the
 * page (lib/kb/retitle-imports.ts). New imports put the page's own title in
 * front of each heading ("Pricing › Pro"). Older ones hold the heading alone,
 * and the page title was never stored, but the page's address was, so the
 * page part is built from that: /pricing gives "pricing › Pro".
 */

// "index.html", "index.htm", "index.php" and the like name the folder they sit in.
const INDEX_PAGE = /^index(\.[a-z0-9]+)?$/i
// Only real page extensions are dropped, so "v1.2", "2.0" and "node.js" survive.
const PAGE_EXTENSION = /\.(s?html?|xhtml|php\d?|aspx?|jsp|cfm|mdx?|txt)$/i
// Long enough to tell pages apart, short enough to leave most of the
// 300-character title for the heading (a heading longer than that is cut at
// its end, as on a new import).
const MAX_ADDRESS_TITLE_CHARS = 120

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** A readable page title from a page address: its path without extension, or the site name for the home page. */
export function addressTitle(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url.trim()
  }
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodePart)
  if (parts.length > 0 && INDEX_PAGE.test(parts[parts.length - 1])) parts.pop()
  if (parts.length > 0) parts[parts.length - 1] = parts[parts.length - 1].replace(PAGE_EXTENSION, '')
  // Slugs read as words: "getting-started" is "getting started", which also
  // matches a "Getting started" heading instead of being put in front of it.
  const words = parts.map((p) => p.replace(/[-_]+/g, ' ').trim()).filter(Boolean)
  const path = words.join('/')
  if (!path) return parsed.hostname.replace(/^www\./i, '')
  if (path.length <= MAX_ADDRESS_TITLE_CHARS) return path
  // The end of a long path says the most about the page, so that is what is
  // kept, starting at a whole part where one begins inside the limit.
  const tail = path.slice(-MAX_ADDRESS_TITLE_CHARS)
  const cut = tail.indexOf('/')
  return cut >= 0 && cut < tail.length - 1 ? tail.slice(cut + 1) : tail
}

const sameAddress = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()

/**
 * The title a section from this page gets: the same rule a new import uses
 * (sectionTitle), with the page from its address. A page imported without a
 * title of its own was titled with its address; that becomes the readable
 * page title rather than getting the page put in front of it.
 */
export function retitledQuestion(url: string, question: string): string {
  if (sameAddress(question, url)) return addressTitle(url)
  return sectionTitle(addressTitle(url), question)
}
