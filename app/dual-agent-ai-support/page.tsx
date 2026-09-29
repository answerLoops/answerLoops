import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'Dual-agent AI support: what it means and why it matters | answerLoops',
  description:
    'Dual-agent AI support means one AI drafts a reply and a separate AI checks that draft against the evidence before it counts as confident. Here is what that catches that a single-pass AI support tool can’t.',
  path: '/dual-agent-ai-support',
})

export default async function DualAgentAiSupportPage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="How answerLoops works"
      title="What is dual-agent AI support?"
      intro="Dual-agent AI support means the model that drafts an answer is never the model that decides whether that answer is trustworthy. One agent retrieves your documentation and writes a reply. A separate agent checks the draft against the retrieved sources and assigns a confidence score based on that check, not on how the draft reads."
      audience="Anyone evaluating AI support tools who wants to understand what a confidence score actually measures before turning on automatic replies."
      highlights={[
        {
          title: 'A single-pass model grades its own homework',
          body: 'A tool that drafts and scores its own answer in one pass has no independent vantage point on whether the draft drifted from its sources — the same reasoning produced both.',
        },
        {
          title: 'A review step changes what confidence means',
          body: 'When a separate agent checks the draft against the evidence, "high confidence" means an independent check found the answer supported — not that the drafting model liked its own output.',
        },
        {
          title: 'Retrieval match and answer accuracy are different things',
          body: 'Finding the right documentation is not the same as staying faithful to it once drafting starts. A close text match doesn’t confirm the answer is correct; the review step exists to check that separately.',
        },
        {
          title: 'It changes how you roll out automation, not just how it scores',
          body: 'Automatic replies stay off by default until you’ve watched a batch of reviewed drafts and trust the pattern — the review step gives you something to actually evaluate before trusting it unsupervised.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Draft from retrieved sources',
          body: 'The first agent retrieves relevant documentation and past resolutions, then drafts a reply from that material.',
        },
        {
          step: '02',
          title: 'Review against the evidence',
          body: 'A separate agent checks the draft against what was actually retrieved and assigns a confidence score based on that comparison.',
        },
        {
          step: '03',
          title: 'Send, hold, or escalate',
          body: 'A draft that clears your confidence threshold can post automatically if you’ve enabled it; everything else waits in your ticket queue for a person.',
        },
      ]}
      comparison={[
        {
          question: 'What is dual-agent AI support?',
          answer:
            'An AI support design where drafting and review are two separate steps run by two separate passes — one agent writes a reply from retrieved documentation, and a different agent checks that reply against the evidence before it’s trusted, rather than one model drafting and scoring its own answer.',
        },
        {
          question: 'How is this different from a single AI chatbot answering support tickets?',
          answer:
            'A single-pass chatbot generates an answer and a confidence estimate from the same reasoning chain, so it has no independent check on whether the answer actually matches its sources. Dual-agent review adds a separate check specifically for that — whether the draft is supported by the retrieved evidence, not just how fluent it reads.',
        },
        {
          question: 'Does a higher confidence threshold guarantee a correct answer?',
          answer:
            'No. A higher threshold makes the review agent more selective about what qualifies for automatic reply, but no threshold guarantees correctness. Inspect drafts and their sources when deciding whether to raise or lower it for a given channel.',
        },
        {
          question: 'Is automatic reply required to use dual-agent review?',
          answer:
            'No. Every draft goes through the same drafting-and-review pipeline whether or not automatic replies are enabled. With automatic replies off, a person approves each draft; the review step still produces the confidence score either way.',
        },
      ]}
      docs={[
        {
          label: 'Read why we built it this way',
          href: '/blog/dual-agent-review',
        },
        {
          label: 'Configure answer review and confidence thresholds',
          href: '/docs/product/ai-deflection',
        },
      ]}
      schema={{
        name: 'What is dual-agent AI support?',
        description:
          'Dual-agent AI support means one AI drafts a reply and a separate AI checks that draft against the evidence before it counts as confident.',
        path: '/dual-agent-ai-support',
      }}
    />
  )
}
