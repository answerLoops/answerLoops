'use server'

import { refresh } from 'next/cache'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { encryptToken } from '@/lib/crypto/tokens'
import { NOTION_TOKEN_RE, getNotionBotUser } from '@/lib/notion/client'
import { getNotionConnectionRow, saveNotionConnection, deleteNotionConnection } from '@/lib/db/queries/notion'
import { getKBSourceByFilename, deleteKBSource } from '@/lib/db/queries/kb-sources'
import { NOTION_SOURCE_FILENAME } from '@/lib/notion/kb-sync'

export async function saveNotionConnectionAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  const token = String(formData.get('token') ?? '').trim()
  const existing = await getNotionConnectionRow(orgId)

  if (!token) {
    if (existing) return null // no change — keep the saved token
    return { error: 'Paste your Notion integration token' }
  }
  if (!NOTION_TOKEN_RE.test(token)) {
    return { error: "That doesn't look like a Notion internal integration token — it should start with ntn_ or secret_" }
  }

  let workspaceName: string | null = null
  if (!MOCK_EXTERNALS) {
    try {
      workspaceName = (await getNotionBotUser(token)).workspaceName
    } catch {
      return { error: 'Notion rejected that token — check it was copied in full and the integration still exists' }
    }
  }

  await saveNotionConnection({ orgId, accessToken: encryptToken(token), workspaceName })
  refresh()
  return null
}

export async function deleteNotionConnectionAction(
  _prevState: unknown,
  _formData: FormData
): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  await deleteNotionConnection(orgId)
  // Disconnecting also drops the synced content.
  const source = await getKBSourceByFilename(orgId, NOTION_SOURCE_FILENAME)
  if (source) await deleteKBSource(source.id, orgId)

  refresh()
  return null
}
