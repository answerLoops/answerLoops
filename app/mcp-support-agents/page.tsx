import type { Metadata } from 'next'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Give your agents access to support knowledge | AnswerLoops',
  description:
    'Connect an MCP-compatible client or use the REST API to search your knowledge base, generate reviewed answers, and create support tickets.',
  alternates: { canonical: '/mcp-support-agents' },
}
export default async function Page() {
  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="Use case"
      title="Give your agents access to support knowledge"
      intro="Connect an MCP-compatible client or use the REST API to search your knowledge base, generate reviewed answers, and create support tickets."
      audience="Teams connecting coding assistants, internal tools, or support automations to their existing documentation and ticket queue."
      highlights={[
        {
          title: 'Search existing knowledge',
          body: 'Retrieve relevant knowledge-base articles and FAQs without maintaining a separate index.',
        },
        {
          title: 'Generate a reviewed answer',
          body: 'Use the same drafting and AI-review steps as channel support.',
        },
        {
          title: 'Create a ticket',
          body: 'Give the support team a request to follow up when the agent needs human help.',
        },
        {
          title: 'Choose permissions',
          body: 'Select the scopes each API key needs when you create it.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Create a key',
          body: 'Open API Keys in Settings and select the required permissions.',
        },
        {
          step: '02',
          title: 'Connect your client',
          body: 'Follow the MCP guide or the REST API reference for authentication and requests.',
        },
        {
          step: '03',
          title: 'Test the workflow',
          body: 'Verify that the agent can retrieve the intended sources and create a ticket with enough context for your team.',
        },
      ]}
      comparison={[
        {
          question: 'Which tools are available?',
          answer:
            'The MCP guide documents search_kb, get_faq, get_tickets, create_ticket, and generate_answer.',
        },
        {
          question: 'Does this use separate knowledge?',
          answer:
            'No. Agent requests use the knowledge in the workspace associated with the API key.',
        },
        {
          question: 'Do generated answers count toward usage?',
          answer:
            'High-confidence standalone answers count toward the monthly automated-answer allowance. See the billing reference for the counting rules.',
        },
      ]}
      docs={[
        {
          label: 'MCP guide',
          href: '/docs/integrations/mcp',
        },
        {
          label: 'Agent API reference',
          href: '/docs/integrations/agent-api',
        },
      ]}
      schema={{
        name: 'Give your agents access to support knowledge',
        description:
          'Connect an MCP-compatible client or use the REST API to search your knowledge base, generate reviewed answers, and create support tickets.',
        path: '/mcp-support-agents',
      }}
    />
  )
}
