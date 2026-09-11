/** Channel names shared by the public website. */
export interface MarketedChannel {
  /** Display name, exactly as it should appear in copy. */
  name: string
  href: string
  /** Brand color, for the channel rail icons on the landing page. */
  color: string
}

export const MARKETED_CHANNELS: readonly MarketedChannel[] = [
  { name: 'Discord', href: '/docs/integrations/discord', color: '#5865f2' },
  { name: 'Slack', href: '/docs/integrations/slack', color: '#36c5f0' },
  { name: 'Discourse', href: '/docs/integrations/discourse', color: '#e4572e' },
  { name: 'Circle', href: '/docs/integrations/circle', color: '#7c3aed' },
  { name: 'GitHub', href: '/docs/integrations/github', color: '#24292f' },
  { name: 'Telegram', href: '/docs/integrations/telegram', color: '#229ed9' },
  { name: 'Email', href: '/docs/integrations/email', color: '#64748b' },
  {
    name: 'Google Chat',
    href: '/docs/integrations/google-chat',
    color: '#34a853',
  },
  { name: 'Website widget', href: '/docs/product/widget', color: '#2563eb' },
] as const

/** Just the names, in canonical order. */
export const MARKETED_CHANNEL_NAMES: readonly string[] = MARKETED_CHANNELS.map(
  (c) => c.name,
)

/**
 * The canonical list as a comma-separated sentence fragment with an Oxford
 * "and" before the last item — e.g. "Discord, Slack, …, and a website widget".
 * `lastLabel` overrides the final item's wording (the rail says "Website
 * widget", prose usually wants "a website widget").
 */
export function channelListSentence(lastLabel = 'a website widget'): string {
  const names = [...MARKETED_CHANNEL_NAMES.slice(0, -1), lastLabel]
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}
