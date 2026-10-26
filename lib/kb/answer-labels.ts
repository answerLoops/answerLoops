import type { KBAnswerOutcome, KBAnswerSourceStatus, KBAnswerSurface } from '@/types'

/** The words the dashboard uses for where an answer was given. Free of server imports so client components can use it. */
export const SURFACE_LABEL: Record<KBAnswerSurface, string> = {
  widget: 'Website chat widget',
  ticket: 'Support ticket draft',
  discord: 'Discord /ask',
  agent_api: 'Agent API',
}

export const OUTCOME_LABEL: Record<KBAnswerOutcome, string> = {
  generated: 'Answer generated',
  failed: 'Generation failed',
}

/** What each source status says, always in words: the icon is decoration, so the state is never carried by colour alone. */
export const SOURCE_STATUS: Record<KBAnswerSourceStatus, { label: string; detail: string }> = {
  current: { label: 'Current', detail: 'Unchanged since this answer was generated.' },
  changed: { label: 'Changed since', detail: 'Edited or re-synced after this answer was generated.' },
  unpublished: { label: 'Unpublished', detail: 'No longer live, so the assistant cannot use it now.' },
  deleted: { label: 'Deleted', detail: 'The article no longer exists.' },
}
