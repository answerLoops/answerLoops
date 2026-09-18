/**
 * Thin raw-fetch wrapper over the Notion REST API. No `@notionhq/client`
 * dependency — the repo already talks to third-party APIs (GitHub GraphQL,
 * Discourse) with bare `fetch`, and we only need a handful of endpoints.
 */

const NOTION_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

/** Notion internal integration secrets: legacy `secret_…`, current `ntn_…`. */
export const NOTION_TOKEN_RE = /^(ntn_|secret_)[A-Za-z0-9]{20,}$/

// Independent ceilings on how much /search pulls, so a huge workspace can't
// hang a sync. Pages and databases have separate budgets — a workspace with
// thousands of shared pages used to leave nothing for databases, which then
// silently never synced.
export const MAX_NOTION_PAGES = 2000
export const MAX_NOTION_DATABASES = 500

export interface NotionRichText {
  plain_text?: string
  annotations?: { code?: boolean; bold?: boolean }
}

export interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

interface NotionListResponse<T> {
  results: T[]
  has_more?: boolean
  next_cursor?: string | null
}

export async function notionFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Notion-Version', NOTION_VERSION)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${NOTION_BASE}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(10_000) })
}

async function notionJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await notionFetch(token, path, init)
  if (!res.ok) {
    let message = `Notion API error ${res.status}`
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) message = body.message
    } catch {
      /* keep the status-only message */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

/**
 * Confirm the token works and grab the workspace name. Doubles as the
 * connect-time validity check.
 */
export async function getNotionBotUser(token: string): Promise<{ workspaceName: string | null }> {
  const me = await notionJson<{ bot?: { workspace_name?: string | null } }>(token, '/users/me')
  return { workspaceName: me.bot?.workspace_name ?? null }
}

async function paginate<T>(
  token: string,
  path: string,
  body: Record<string, unknown> | null,
  cap: number
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  do {
    const payload = body ? { ...body, page_size: 100, ...(cursor && { start_cursor: cursor }) } : undefined
    const page = payload
      ? await notionJson<NotionListResponse<T>>(token, path, { method: 'POST', body: JSON.stringify(payload) })
      : await notionJson<NotionListResponse<T>>(
          token,
          `${path}${path.includes('?') ? '&' : '?'}page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
        )
    out.push(...page.results)
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined
  } while (cursor && out.length < cap)
  return out.slice(0, cap)
}

export interface NotionObject {
  object: 'page' | 'database'
  id: string
  properties?: Record<string, unknown>
  title?: NotionRichText[]
}

export interface NotionSearchResult {
  pages: NotionObject[]
  databases: NotionObject[]
  /** True when the respective budget was hit and some objects were left out. */
  pagesCapped: boolean
  databasesCapped: boolean
}

/**
 * Every page + database the integration can see. Pages and databases are
 * paginated against separate budgets (`MAX_NOTION_PAGES` / `MAX_NOTION_DATABASES`)
 * so a large set of one never starves the other.
 */
export async function notionSearchAll(token: string): Promise<NotionSearchResult> {
  const pages = await paginate<NotionObject>(
    token,
    '/search',
    { filter: { property: 'object', value: 'page' } },
    MAX_NOTION_PAGES
  )
  const databases = await paginate<NotionObject>(
    token,
    '/search',
    { filter: { property: 'object', value: 'database' } },
    MAX_NOTION_DATABASES
  )
  return {
    pages,
    databases,
    pagesCapped: pages.length >= MAX_NOTION_PAGES,
    databasesCapped: databases.length >= MAX_NOTION_DATABASES,
  }
}

export async function notionBlockChildren(token: string, blockId: string): Promise<NotionBlock[]> {
  return paginate<NotionBlock>(token, `/blocks/${blockId}/children`, null, 500)
}

export async function queryDatabaseRows(token: string, databaseId: string): Promise<NotionObject[]> {
  return paginate<NotionObject>(token, `/databases/${databaseId}/query`, {}, 500)
}

/** Best-effort human title for a page or a database row. */
export function getNotionPageTitle(obj: NotionObject): string {
  // Databases carry the title at the top level.
  if (Array.isArray(obj.title) && obj.title.length) {
    return obj.title.map((t) => t.plain_text ?? '').join('').trim() || 'Untitled'
  }
  // Pages: the property whose type is 'title'.
  const props = obj.properties ?? {}
  for (const value of Object.values(props)) {
    const prop = value as { type?: string; title?: NotionRichText[] }
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? '').join('').trim()
      if (text) return text
    }
  }
  return 'Untitled'
}
