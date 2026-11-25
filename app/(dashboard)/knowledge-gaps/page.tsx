import { redirect } from 'next/navigation'

/**
 * Knowledge Gaps now lives on the Knowledge Base page as the Gaps tab. This
 * keeps old links, bookmarks and docs pointing at the right place.
 */
export default function KnowledgeGapsRedirect() {
  redirect('/kb?tab=gaps')
}
