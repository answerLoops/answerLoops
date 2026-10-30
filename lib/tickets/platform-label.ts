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

/** Customer-facing name of a ticket's source channel. */
export function platformLabel(platform: string | null | undefined): string {
  return LABELS[platform ?? 'discord'] ?? platform ?? 'Discord'
}
