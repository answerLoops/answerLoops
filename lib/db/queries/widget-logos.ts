import { eq, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { widgetLogos } from '../schema'

/** A workspace's stored logo, as the small re-encoded image. */
export interface WidgetLogo {
  contentType: string
  bytes: Buffer
  etag: string
}

/** What the address of a logo needs, without reading the image itself. */
export interface WidgetLogoVersion {
  etag: string
}

export async function getWidgetLogo(orgId: number): Promise<WidgetLogo | null> {
  const [row] = await getDb()
    .select({ contentType: widgetLogos.contentType, bytes: widgetLogos.bytes, etag: widgetLogos.etag })
    .from(widgetLogos)
    .where(eq(widgetLogos.orgId, orgId))
    .limit(1)
  if (!row) return null
  return { contentType: row.contentType, bytes: Buffer.from(row.bytes), etag: row.etag }
}

/** The version of a workspace's logo, or null when it has none. Cheap: it never reads the image. */
export async function getWidgetLogoVersion(orgId: number): Promise<WidgetLogoVersion | null> {
  const [row] = await getDb()
    .select({ etag: widgetLogos.etag })
    .from(widgetLogos)
    .where(eq(widgetLogos.orgId, orgId))
    .limit(1)
  return row ? { etag: row.etag } : null
}

/** Stores a workspace's logo, replacing any earlier one. */
export async function setWidgetLogo(orgId: number, logo: WidgetLogo): Promise<WidgetLogoVersion> {
  await getDb()
    .insert(widgetLogos)
    .values({ orgId, contentType: logo.contentType, bytes: logo.bytes, etag: logo.etag })
    .onConflictDoUpdate({
      target: widgetLogos.orgId,
      set: { contentType: logo.contentType, bytes: logo.bytes, etag: logo.etag, updatedAt: sql`now()` },
    })
  return { etag: logo.etag }
}

/** Removes a workspace's logo. Harmless when there is none. */
export async function deleteWidgetLogo(orgId: number): Promise<void> {
  await getDb().delete(widgetLogos).where(eq(widgetLogos.orgId, orgId))
}
