import type { Priority } from '@/types'

export const SLA_PRIORITIES: readonly Priority[] = ['critical', 'high', 'medium', 'low']

// Used only when neither the workspace nor the global default table has a row
// for a priority.
export const BUILT_IN_SLA_TARGETS: Record<Priority, { response_hours: number; resolve_hours: number }> = {
  critical: { response_hours: 1, resolve_hours: 4 },
  high: { response_hours: 4, resolve_hours: 24 },
  medium: { response_hours: 24, resolve_hours: 72 },
  low: { response_hours: 72, resolve_hours: 168 },
}
