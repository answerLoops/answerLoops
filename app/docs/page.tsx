import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Cards } from 'fumadocs-ui/components/card'
import { DocsPage, DocsBody } from 'fumadocs-ui/page'
import {
  BookOpen,
  Cable,
  Cloud,
  Cpu,
  LayoutDashboard,
  Plug,
  Server,
  Ticket,
} from 'lucide-react'
import { LoopIllustration } from '@/components/docs/loop-illustration'
import { PageSchema } from '@/components/marketing/page-schema'
import { publicPageMetadata } from '@/lib/marketing/metadata'
import { channelListSentence } from '@/lib/marketing/channels'

const TITLE = 'answerLoops documentation'
const DESCRIPTION =
  'Set up answerLoops, connect your support channels, and run AI-drafted, AI-reviewed answers for your community.'

export const metadata: Metadata = publicPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/docs',
})

export default function DocsHomePage() {
  return (
    <DocsPage full>
      <PageSchema
        name={TITLE}
        description={DESCRIPTION}
        path="/docs"
        type="CollectionPage"
      />
      <DocsBody>
        <section className="not-prose rounded-2xl border border-fd-border bg-fd-accent px-6 py-10 sm:px-10">
          <p className="text-sm font-medium text-fd-primary">Documentation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Answer your community, faster and with a second opinion
          </h1>
          <p className="mt-3 max-w-2xl text-fd-muted-foreground">
            answerLoops drafts answers from your knowledge, has a separate AI review them, and
            brings in your team when it should. It works across {channelListSentence()}.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/docs/quickstart-cloud"
              className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
            >
              Start in the cloud
            </Link>
            <Link
              href="/docs/quickstart-self-host"
              className="rounded-lg border border-fd-border bg-fd-card px-4 py-2 text-sm font-medium hover:bg-fd-muted"
            >
              Self-host it
            </Link>
          </div>
          <LoopIllustration className="mt-8 h-auto w-full" />
        </section>

        <h2>Choose your path</h2>
        <Cards>
          <Card icon={<Cloud />} title="Cloud quickstart" href="/docs/quickstart-cloud">
            Sign up, add knowledge, and connect your first channel in minutes.
          </Card>
          <Card icon={<Server />} title="Self-host quickstart" href="/docs/quickstart-self-host">
            Run answerLoops on your own infrastructure with Docker.
          </Card>
          <Card icon={<BookOpen />} title="What is answerLoops?" href="/docs/introduction">
            How the loop works, and who it is for.
          </Card>
        </Cards>

        <h2>Find what you need</h2>
        <Cards>
          <Card icon={<LayoutDashboard />} title="Product guide" href="/docs/product/dashboard">
            The dashboard, knowledge base, tickets, automatic replies, and analytics.
          </Card>
          <Card icon={<Plug />} title="Integrations" href="/docs/integrations">
            Channels, knowledge sources, and AI providers.
          </Card>
          <Card icon={<Cable />} title="Agents and API" href="/docs/integrations/mcp">
            MCP server, REST API, and agent skills.
          </Card>
          <Card icon={<Cpu />} title="AI model" href="/docs/product/ai-config">
            Choose a provider and bring your own key.
          </Card>
          <Card icon={<Ticket />} title="Tickets" href="/docs/product/tickets">
            Every question, its source, its answer, and its status.
          </Card>
          <Card icon={<Server />} title="Self-hosting" href="/docs/self-hosting/prerequisites">
            Prerequisites, Docker, production, and upgrades.
          </Card>
        </Cards>
      </DocsBody>
    </DocsPage>
  )
}
