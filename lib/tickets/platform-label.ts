import type { SourcePlatform } from '@/types'

const LABELS = {
  discord: 'Discord',
  slack: 'Slack',
  google_chat: 'Google Chat',
  telegram: 'Telegram',
  email: 'Email',
  github: 'GitHub',
  discourse: 'Discourse',
  circle: 'Circle',
  mcp: 'Agent',
} as const satisfies Record<SourcePlatform, string>

export const SUPPORTED_PLATFORMS: readonly SourcePlatform[] = Object.keys(LABELS) as SourcePlatform[]

export function isSourcePlatform(platform: unknown): platform is SourcePlatform {
  return typeof platform === 'string' && (SUPPORTED_PLATFORMS as readonly string[]).includes(platform)
}

/** Customer-facing name of a ticket's source channel. */
export function platformLabel(platform: string | null | undefined): string {
  return (LABELS as Record<string, string>)[platform ?? 'discord'] ?? platform ?? 'Discord'
}
