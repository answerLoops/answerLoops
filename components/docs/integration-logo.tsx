import { Code, Mail, MessagesSquare } from 'lucide-react'
import { SLACK_LOGO } from '@/lib/marketing/slack-logo'
import { LOGO_GLYPHS } from './integration-logo-data'

/** Display names for the logos, used for alt text and the monogram fallback. */
const NAMES: Record<string, string> = {
  discourse: 'Discourse',
  discord: 'Discord',
  slack: 'Slack',
  circle: 'Circle',
  'google-chat': 'Google Chat',
  telegram: 'Telegram',
  email: 'Email',
  github: 'GitHub',
  notion: 'Notion',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  ollama: 'Ollama',
  mcp: 'MCP',
  'agent-skills': 'Agent skills',
  stripe: 'Stripe',
  channels: 'Your channels',
  'agent-api': 'Agent API',
}

/** Accept 'Google Chat', 'google-chat' or 'googlechat' alike. */
function normalize(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, '-')
  return key === 'googlechat' ? 'google-chat' : key
}

/**
 * An integration's mark on a white, bordered tile, so dark and light brands
 * read the same on the docs background. A name with no mark yet (OpenAI,
 * Groq) renders a neutral monogram instead of a hand-drawn imitation of
 * someone else's logo.
 */
export function IntegrationLogo({
  name,
  size = 40,
  className = '',
}: {
  name: string
  size?: number
  className?: string
}) {
  const key = normalize(name)
  const label = NAMES[key] ?? name
  const glyph = LOGO_GLYPHS[key]
  const inner = Math.round(size * 0.58)

  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-fd-border bg-white shadow-sm ${className}`}
      style={{ width: size, height: size }}
    >
      {key === 'email' || key === 'channels' || key === 'agent-api' ? (
        // Email and "your channels" have no single brand, so they get a plain
        // pictogram instead of borrowing one provider's mark.
        key === 'email' ? (
          <Mail width={inner} height={inner} className="text-fd-foreground" aria-hidden="true" />
        ) : key === 'agent-api' ? (
          <Code width={inner} height={inner} className="text-fd-foreground" aria-hidden="true" />
        ) : (
          <MessagesSquare width={inner} height={inner} className="text-fd-foreground" aria-hidden="true" />
        )
      ) : key === 'slack' ? (
        <svg width={inner} height={inner} viewBox={SLACK_LOGO.viewBox} aria-hidden="true">
          {SLACK_LOGO.paths.map((p) => (
            <path key={p.d} fill={p.fill} d={p.d} />
          ))}
        </svg>
      ) : glyph ? (
        <svg width={inner} height={inner} viewBox={key === 'openai' ? '0 0 716 716' : '0 0 24 24'} fill={glyph.color} aria-hidden="true">
          <path d={glyph.d} />
        </svg>
      ) : (
        <span
          aria-hidden="true"
          className="font-semibold text-fd-foreground"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {label.charAt(0)}
        </span>
      )}
    </span>
  )
}
