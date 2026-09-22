import type { MDXComponents } from 'mdx/types'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { Callout } from 'fumadocs-ui/components/callout'
import { Card, Cards } from 'fumadocs-ui/components/card'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import OpenAPIPage from '@/components/docs/openapi-page-server'
import { channelListSentence } from '@/lib/marketing/channels'
import {
  Bell,
  CircleHelp,
  GitFork,
  MessageCircle,
  Rocket,
  Server,
  Shield,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react'

// Mintlify's `icon="rocket"` cards used Font Awesome brand + solid icon
// names. lucide-react (already a fumadocs-ui peer dep) doesn't ship brand
// marks for Discord/Slack/GitHub, so those three fall back to a generic
// icon rather than pulling in a separate brand-icon package for a handful
// of doc cards.
const mintlifyCardIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  bell: Bell,
  bolt: Zap,
  'circle-question': CircleHelp,
  discord: MessageCircle,
  github: GitFork,
  rocket: Rocket,
  server: Server,
  shield: Shield,
  slack: MessageCircle,
  sliders: SlidersHorizontal,
  users: Users,
}

/**
 * Renders the Mintlify-flavoured `<Card icon="rocket" ...>` string prop as
 * the matching Fumadocs/lucide icon component, so pages ported straight
 * from docs/**\/*.mdx don't need every `icon="..."` attribute hand-edited.
 */
function MintlifyCard({
  icon,
  ...props
}: React.ComponentProps<typeof Card> & { icon?: React.ReactNode }) {
  const resolvedIcon =
    typeof icon === 'string' && icon in mintlifyCardIcons
      ? (() => {
          const Icon = mintlifyCardIcons[icon]
          return <Icon />
        })()
      : icon
  return <Card icon={resolvedIcon} {...props} />
}

// Renders the generated content/docs/reference/api/**\/*.mdx pages (see
// scripts/generate-api-reference.mjs) — each one exports a `Layout` that
// pulls `OpenAPIPage`/`APIPage` off `components`, exactly like fumadocs-mdx's
// own generateFiles() output expects.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    OpenAPIPage,
    APIPage: OpenAPIPage,
    // Mintlify callout syntax -> Fumadocs Callout, mapped by semantic intent.
    Info: (props: React.ComponentProps<typeof Callout>) => <Callout type="info" {...props} />,
    Note: (props: React.ComponentProps<typeof Callout>) => <Callout type="info" {...props} />,
    Warning: (props: React.ComponentProps<typeof Callout>) => <Callout type="warn" {...props} />,
    Tip: (props: React.ComponentProps<typeof Callout>) => <Callout type="idea" {...props} />,
    // Mintlify cards -> Fumadocs cards (CardGroup's `cols` prop is dropped;
    // Fumadocs Cards auto-flows into a responsive grid).
    CardGroup: Cards,
    Card: MintlifyCard,
    // Mintlify tabs/accordions/steps map 1:1 onto Fumadocs equivalents.
    Tabs,
    Tab,
    AccordionGroup: Accordions,
    Accordion,
    Steps,
    Step,
    // Blog posts reference the connected-channel list in prose; this keeps
    // it sourced from lib/marketing/channels.ts instead of a hardcoded list
    // in a post's MDX that can drift when a channel is added or renamed.
    ChannelList: () => <>{channelListSentence()}</>,
    ...components,
  }
}
