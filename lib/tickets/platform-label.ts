import type { SourcePlatform } from '@/types'

export const SUPPORTED_PLATFORMS: readonly SourcePlatform[] = [
  'discord',
  'slack',
  'google_chat',
  'telegram',
  'email',
  'github',
  'discourse',
  'circle',
  'mcp',
] as const

const LABELS: Record<string, string> = {
  discord: 'Discord',
  slack: 'Slack',
  google_chat: 'Google Chat',
  telegram: 'Telegram',
  email: 'Email',
  github: 'GitHub',
  discourse: 'Discourse',
  circle: 'Circle',
  mcp: 'Agent',
}

export function isSourcePlatform(platform: unknown): platform is SourcePlatform {
  return typeof platform === 'string' && (SUPPORTED_PLATFORMS as readonly string[]).includes(platform)
}

/** Customer-facing name of a ticket's source channel. */
export function platformLabel(platform: string | null | undefined): string {
  return LABELS[platform ?? 'discord'] ?? platform ?? 'Discord'
}
