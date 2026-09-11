import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { MarketingPage, PageHero } from '@/components/marketing/layout'

export const metadata: Metadata = {
  title: 'Privacy Policy — AnswerLoops',
  description:
    'How AnswerLoops collects, uses, stores, and protects data for connected support channels, AI processing, and billing.',
}

const EFFECTIVE_DATE = 'August 12, 2026'

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="border-t border-slate-200/80 py-8 first:border-t-0 first:pt-0"
    >
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-slate-600">
        {children}
      </div>
    </section>
  )
}

export default function PrivacyPolicyPage() {
  return (
    <MarketingPage>
      <PageHero eyebrow="Legal" title="Privacy Policy">
        <p>Effective {EFFECTIVE_DATE}</p>
      </PageHero>

      <section className="marketing-section">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <p className="text-sm leading-relaxed text-slate-600">
            This policy covers the AnswerLoops hosted service
            (&ldquo;AnswerLoops&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). For
            your account, billing, and team information, AnswerLoops is the{' '}
            <strong>data controller</strong>. For the questions, replies, and
            other content your organization ingests through a connected channel,
            AnswerLoops acts as a <strong>data processor</strong> on your
            organization&apos;s behalf &mdash; your organization determines what
            gets connected and controls that content. If you run the
            open-source, self-hosted edition instead, you are the data
            controller for your own deployment and this policy doesn&apos;t
            apply to that instance &mdash; your own privacy policy governs it.
          </p>

          <Section id="what-we-collect" title="What we collect">
            <p>
              Account &amp; auth &mdash; name, email, and profile image from
              Google Sign-In, plus your organization name and team member roles.
            </p>
            <p>
              Connected channel content &mdash; each channel only grants the
              access needed to answer support questions in it, and content read
              from a channel is used solely to create tickets and generate
              answers, never for anything else:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Discord</strong> &mdash; our bot reads messages in the
                channels and threads it&apos;s added to, to detect questions and
                post answers.
              </li>
              <li>
                <strong>Slack</strong> &mdash; an installed org authorizes
                specific OAuth scopes for reading and posting messages in the
                channels it connects.
              </li>
              <li>
                <strong>Google Chat</strong> &mdash; a paired space sends us the
                messages posted in it; we do not use this data to develop,
                improve, or train any general-purpose or non-personalized AI/ML
                model, consistent with Google&apos;s API Services User Data
                Policy.
              </li>
              <li>
                <strong>Discourse and Circle</strong> &mdash; posts and comments
                from the categories or spaces your organization connects.
              </li>
              <li>
                <strong>GitHub</strong> &mdash; a GitHub App installation reads
                Issues and Discussions and writes comments, scoped to the
                repositories you select.
              </li>
              <li>
                <strong>Telegram</strong> &mdash; our bot reads messages sent to
                it directly or in groups it&apos;s added to.
              </li>
              <li>
                <strong>Email</strong> &mdash; inbound messages forwarded to
                your connected address, or sent via a Gmail/Outlook mailbox you
                connect with send-only OAuth scopes (we never read that
                mailbox&apos;s inbox).
              </li>
              <li>
                <strong>Website widget</strong> &mdash; visitor messages and, if
                a visitor provides one, their email address.
              </li>
            </ul>
            <p>
              Knowledge sources &mdash; files, documentation URLs, repository
              content, and Notion pages your organization imports into its
              knowledge base.
            </p>
            <p>
              Integration credentials &mdash; OAuth tokens, bot tokens, and
              webhook secrets for each channel you connect. These are encrypted
              at rest and used only to send/receive messages on your behalf.
            </p>
            <p>
              AI provider keys &mdash; if you configure your own OpenAI,
              Anthropic, Google, Groq, Mistral, or other provider key, it&apos;s
              encrypted at rest and used only to call that provider on your
              organization&apos;s behalf. Saved keys are not displayed again in
              Settings.
            </p>
            <p>
              Billing &mdash; handled by Stripe. We store your Stripe customer,
              subscription, and price identifiers; we never store card numbers
              ourselves.
            </p>
            <p>
              Usage &amp; product data &mdash; tickets, KB articles and
              embeddings, SLA and CSAT records, analytics events, feature-flag
              assignments, and API usage tied to your organization.
            </p>
          </Section>

          <Section id="how-we-use-it" title="How we use it">
            <p>
              To operate the product: route incoming questions, generate and
              grade AI answers, maintain your knowledge base, enforce SLAs, and
              show your dashboard/analytics.
            </p>
            <p>To bill your subscription and enforce plan limits.</p>
            <p>
              To send transactional email (ticket notifications, billing
              receipts, team invites) and, if you opt in, product updates.
            </p>
            <p>
              We do not sell personal data, and we do not use it for behavioral
              advertising.
            </p>
          </Section>

          <Section id="ai-processing" title="AI processing">
            <p>
              AnswerLoops uses model services to draft and review replies and to
              create embeddings for knowledge search. Your organization
              configures its chat and embedding providers. These may be
              different services.
            </p>
            <p>
              New hosted workspaces receive a one-time allowance of five
              AI-processed tickets using AnswerLoops-provided model access.
              After that allowance, your organization must configure its own
              provider credentials to continue AI processing.
            </p>
            <p>
              Processing can include the question, relevant knowledge, recent
              conversation context, and source content used for indexing. The
              model provider processes this content under its own terms. Review
              the policies of each configured provider, including the embedding
              provider.
            </p>
            <p>
              We do not use ticket, message, or knowledge-base content to train
              models we operate.
            </p>
          </Section>

          <Section id="who-we-share-with" title="Who we share it with">
            <p>
              Sub-processors that support running the service: Stripe
              (payments), Resend (transactional email), and our cloud hosting
              and database providers (storage and infrastructure). Each
              processes data only as needed to provide their service to us.
            </p>
            <p>
              Discord, Slack, Discourse, Circle, Google, GitHub, and Telegram
              each receive the messages your organization sends back through
              their platform &mdash; governed by their own privacy terms as well
              as ours.
            </p>
            <p>
              We disclose data if legally required to, or to protect the
              security or rights of AnswerLoops or our users. We otherwise do
              not share personal data with third parties.
            </p>
          </Section>

          <Section id="retention" title="Data retention & deletion">
            <p>
              Deleting your organization starts a 30-day grace period during
              which an owner can restore it. After 30 days, the organization and
              its data (tickets, KB content, integrations, credentials) are
              permanently purged.
            </p>
            <p>
              Disconnecting a single channel immediately deletes that
              channel&apos;s stored credentials (tokens, bot secrets) and stops
              new content from being ingested; content already ingested before
              disconnecting remains part of your organization&apos;s ticket and
              KB history until your organization is deleted.
            </p>
            <p>
              Each connected platform (Discord, Slack, Google Chat, GitHub,
              Telegram) has its own data retention and deletion policy governing
              content on its side. Where a platform&apos;s own policy requires
              deleting data sooner than the timeline above, we defer to that
              shorter timeline for the data originating from that platform.
            </p>
            <p>
              Widget leads and email addresses collected through connected
              channels are retained as part of your organization&apos;s data and
              deleted on the same schedule.
            </p>
            <p>
              You can also ask us to delete specific data outside the normal
              account-deletion flow by emailing us at the address below;
              we&apos;ll act on that request within 30 days.
            </p>
          </Section>

          <Section id="security" title="Security">
            <p>
              Integration tokens and AI provider keys are encrypted at rest.
              Access to your organization&apos;s data is scoped to your team
              members and enforced at the database query layer. We run automated
              dependency, secret, and static-analysis scans on every change to
              this codebase.
            </p>
            <p>
              If we become aware of a security incident affecting your data,
              we&apos;ll notify affected organizations without undue delay.
            </p>
          </Section>

          <Section id="your-rights" title="Your rights">
            <p>
              Depending on where you live, you may have some or all of the
              following rights over your personal data: to access a copy of it,
              to correct it, to request its deletion, to receive it in a
              portable format, to object to or restrict certain processing, and
              to lodge a complaint with your local data protection authority.
              You can exercise most of these from Settings, or by emailing us at
              the address below.
            </p>
          </Section>

          <Section
            id="international-transfers"
            title="International data transfers"
          >
            <p>
              Our systems are hosted in the United States. If you or your
              organization access AnswerLoops from outside the United States,
              your data will be transferred to and processed in the United
              States.
            </p>
          </Section>

          <Section id="childrens-privacy" title="Children's privacy">
            <p>
              AnswerLoops is a business tool and is not directed at children. We
              do not knowingly collect data from anyone under 16.
            </p>
          </Section>

          <Section id="changes" title="Changes to this policy">
            <p>
              We&apos;ll update the effective date above when this policy
              changes, and post material changes on this page before they take
              effect.
            </p>
          </Section>

          <Section id="contact" title="Contact">
            <p>
              Questions about this policy or a data request:{' '}
              <a
                href="mailto:hello@answerloops.com"
                className="font-medium text-blue-600 hover:underline"
              >
                hello@answerloops.com
              </a>
              .
            </p>
          </Section>
        </div>
      </section>
    </MarketingPage>
  )
}
