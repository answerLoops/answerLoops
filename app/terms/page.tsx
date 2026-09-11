import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { MarketingPage, PageHero } from '@/components/marketing/layout'

export const metadata: Metadata = {
  title: 'Terms of Service — answerLoops',
  description:
    'Terms governing access to and use of the answerLoops hosted service, subscriptions, connected channels, and AI features.',
}

const EFFECTIVE_DATE = 'August 22, 2026'

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
      className="scroll-mt-24 border-t border-slate-200/80 py-8 first:border-t-0 first:pt-0"
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

export default function TermsOfServicePage() {
  return (
    <MarketingPage>
      <PageHero eyebrow="Legal" title="Terms of Service">
        <p>Effective {EFFECTIVE_DATE}</p>
      </PageHero>

      <section className="marketing-section">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <p className="text-sm leading-relaxed text-slate-600">
            These Terms of Service (&ldquo;Terms&rdquo;) govern access to and
            use of the answerLoops hosted websites, applications, APIs, bots,
            widgets, and related services (the &ldquo;Service&rdquo;). By
            creating an account, accepting an invitation to a workspace,
            starting a trial, purchasing a subscription, or using the Service,
            you agree to these Terms and our{' '}
            <Link
              href="/privacy"
              className="font-medium text-blue-600 hover:underline"
            >
              Privacy Policy
            </Link>
            . If you use the Service for a company or other organization, you
            represent that you have authority to bind it, and &ldquo;you&rdquo;
            includes that organization. If you do not agree, do not use the
            Service.
          </p>

          <nav
            aria-label="Terms of Service sections"
            className="my-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              On this page
            </p>
            <ol className="mt-3 grid gap-x-8 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
              {[
                ['eligibility', 'Eligibility and authority'],
                ['cloud-and-self-hosted', 'Cloud and self-hosted editions'],
                ['accounts', 'Accounts and workspaces'],
                ['service', 'The Service'],
                ['customer-content', 'Customer Content'],
                ['ai-features', 'AI features'],
                ['third-party-services', 'Third-party services'],
                ['acceptable-use', 'Acceptable use'],
                ['subscriptions', 'Subscriptions and billing'],
                ['cancellation', 'Cancellation and refunds'],
                ['intellectual-property', 'Intellectual property'],
                ['confidentiality', 'Confidentiality and privacy'],
                ['suspension', 'Suspension and termination'],
                ['disclaimers', 'Disclaimers'],
                ['liability', 'Limitation of liability'],
                ['indemnification', 'Indemnification'],
                ['general', 'General terms'],
              ].map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="transition-colors hover:text-blue-600 hover:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <Section id="eligibility" title="1. Eligibility and authority">
            <p>
              The Service is a business tool. You must be at least 18 years old,
              have reached the age of legal majority where you live, and be able
              to enter into a binding contract. You may not use the Service if
              applicable law bars you from doing so.
            </p>
            <p>
              If you register with an organization-controlled email address or
              join an organization&apos;s workspace, that organization may
              administer your access and Customer Content, change your role, or
              remove you from the workspace. The organization is responsible for
              its users&apos; compliance with these Terms.
            </p>
          </Section>

          <Section
            id="cloud-and-self-hosted"
            title="2. Cloud and self-hosted editions"
          >
            <p>
              These Terms apply to answerLoops Cloud and the public answerLoops
              websites. They do not replace or change the open-source license
              governing answerLoops source code. If you download, modify, or
              operate the self-hosted edition, your use of that software is
              governed by the license included with the source code, currently
              the GNU Affero General Public License version 3.
            </p>
            <p>
              You, not answerLoops, operate a self-hosted deployment and are
              responsible for its infrastructure, configuration, security,
              availability, legal compliance, notices to its users, and
              relationships with any third-party providers. Hosted support,
              service levels, and subscriptions do not apply to self-hosted
              deployments unless a separate written agreement says otherwise.
            </p>
          </Section>

          <Section id="accounts" title="3. Accounts and workspaces">
            <p>
              You must provide accurate, current account and billing
              information, keep it updated, and protect your sign-in methods,
              API keys, integration credentials, and devices. Promptly notify us
              at the contact address below if you suspect unauthorized access.
            </p>
            <p>
              Workspace owners and administrators may invite or remove members,
              assign roles, configure integrations and automated responses,
              manage billing, and control Customer Content. You are responsible
              for actions taken through your account and for ensuring that only
              authorized people can access your workspace. One person or
              organization may not create accounts to evade plan limits,
              restrictions, or suspension.
            </p>
          </Section>

          <Section id="service" title="4. The Service">
            <p>
              answerLoops turns messages from connected support channels into
              tickets, searches the knowledge base you provide, drafts and
              evaluates AI-generated replies, posts qualifying answers when you
              enable automatic responses, and routes other questions for human
              review. Features and limits depend on your plan and configuration.
            </p>
            <p>
              We may improve, add, modify, or discontinue features over time. We
              will provide reasonable advance notice if a change materially
              reduces the core functionality of a paid plan, unless earlier
              action is reasonably necessary for security, legal, or
              third-party-service reasons. Preview, beta, and evaluation
              features may be changed or withdrawn at any time and are provided
              without service commitments.
            </p>
            <p>
              Support and any uptime or response-time commitments are limited to
              those stated for your plan or in a separate written order form or
              service-level agreement.
            </p>
          </Section>

          <Section id="customer-content" title="5. Customer Content">
            <p>
              &ldquo;Customer Content&rdquo; means the messages, tickets, files,
              knowledge-base materials, prompts, replies, contact details, and
              other data you or your users submit to or connect with the
              Service. As between you and answerLoops, you retain ownership of
              Customer Content.
            </p>
            <p>
              You grant answerLoops a worldwide, non-exclusive, limited license
              to host, copy, transmit, display, modify, and otherwise process
              Customer Content only as needed to provide, secure, support, and
              improve the Service, comply with law, and follow your
              instructions. This license lasts while the content is stored in
              the Service and for any limited backup or legal-retention period
              described in the Privacy Policy.
            </p>
            <p>
              You represent that you have all rights, permissions, notices, and
              consents needed for answerLoops to process Customer Content and
              communicate through each channel you connect. You are responsible
              for the legality, accuracy, and quality of Customer Content; the
              responses sent from your workspace; your use of leads or contact
              information; and honoring the rights of the people whose data you
              submit.
            </p>
          </Section>

          <Section id="ai-features" title="6. AI features">
            <p>
              The Service uses third-party AI providers selected or configured
              by you. Except for any limited trial allowance described in the
              product, you supply the provider credentials and contract with and
              pay that provider directly. Provider terms, availability, data
              practices, model behavior, and usage charges are between you and
              the provider.
            </p>
            <p>
              AI-generated classifications, drafts, confidence scores,
              citations, and replies may be inaccurate, incomplete, misleading,
              or unsuitable. Confidence review reduces risk but does not
              guarantee correctness. You decide whether to enable automatic
              posting, set the confidence threshold, choose source material, and
              approve or edit human-reviewed replies. You are responsible for
              evaluating outputs before relying on them and for the consequences
              of messages sent from your workspace.
            </p>
            <p>
              Do not use the Service as the sole basis for legal, medical,
              financial, employment, housing, credit, insurance, public-safety,
              or other high-impact decisions about a person. Do not represent
              AI-generated content as human-authored when applicable law
              requires disclosure.
            </p>
          </Section>

          <Section
            id="third-party-services"
            title="7. Third-party services and integrations"
          >
            <p>
              The Service can connect with services such as Discord, Slack,
              Discourse, Circle, Google Chat, GitHub, Telegram, Notion, email
              providers, Stripe, AI providers, and customer-selected endpoints.
              Your use of a third-party service is governed by its own terms and
              privacy practices, and you authorize us to exchange Customer
              Content and account data with it as needed to perform the
              integration you enable.
            </p>
            <p>
              You are responsible for maintaining third-party accounts,
              permissions, credentials, and lawful access. We do not control and
              are not responsible for third-party services, their acts or
              omissions, or changes that interrupt an integration. Disconnecting
              a service stops new processing but does not automatically delete
              content already incorporated into your answerLoops workspace; the
              Privacy Policy explains retention and deletion.
            </p>
          </Section>

          <Section id="acceptable-use" title="8. Acceptable use">
            <p>You may not use the Service, or help anyone else use it, to:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                break the law, violate another person&apos;s rights, or process
                content without required permission;
              </li>
              <li>
                harass, threaten, defame, exploit, or harm anyone, including
                children;
              </li>
              <li>
                send spam, deceptive messages, malware, or other unsolicited or
                harmful content;
              </li>
              <li>
                gain unauthorized access to accounts, systems, networks, or
                data, or probe or circumvent security, authentication, rate
                limits, or plan controls;
              </li>
              <li>
                disrupt, overload, damage, or degrade the Service or another
                user&apos;s experience;
              </li>
              <li>
                misrepresent identity, affiliation, AI output, or the source of
                a message;
              </li>
              <li>
                resell, sublicense, or provide the hosted Service to third
                parties as a competing service without our written permission;
                or
              </li>
              <li>
                use the Service to develop or train a competing product using
                non-public aspects of the Service, except that this restriction
                does not limit rights granted by the open-source license.
              </li>
            </ul>
            <p>
              Unless we agree in writing, do not submit payment-card data,
              government identifiers, protected health information, highly
              sensitive personal data, or data subject to specialized regulatory
              requirements that the Service is not configured to support.
            </p>
          </Section>

          <Section
            id="subscriptions"
            title="9. Subscriptions, trials, and billing"
          >
            <p>
              answerLoops Cloud plans are billed in advance on a monthly or
              annual basis at the price and in the currency shown at checkout.
              Taxes may be added where required. A valid payment method is
              required. By starting a subscription, you authorize answerLoops
              and its payment processor to charge that method for recurring
              fees, applicable taxes, and any other amount you approve.
            </p>
            <p>
              Paid plans begin with a 14-day trial unless checkout says
              otherwise. Your card is not charged for the subscription fee when
              the trial begins. Unless you cancel before the trial ends, the
              selected paid plan starts automatically when the trial expires and
              your payment method is charged. After that, the subscription
              automatically renews for successive periods matching your chosen
              monthly or annual billing interval until canceled.
            </p>
            <p>
              A &ldquo;deflection&rdquo; is an automated answer counted toward
              your plan allowance. This includes qualifying channel replies and
              high-confidence standalone answers generated through the MCP or
              Agent API. Drafts routed for human review do not count. Allowances
              reset each calendar month, including on annual subscriptions.
              Standard pauses automated answering at 500; Pro includes 3,000 and
              charges $5 per additional block of 100, rounded up; Enterprise has
              no deflection cap. The plan terms shown at checkout or in an
              applicable order form control your purchase.
            </p>
            <p>
              Plan upgrades may take effect and be charged on a prorated basis
              immediately. Downgrades and ordinary cancellations take effect at
              the end of the current paid billing period. We may change prices
              or plan limits for a future renewal by giving reasonable advance
              notice, allowing you to cancel before the change takes effect. An
              order form or enterprise agreement controls if it expressly
              conflicts with these online Terms.
            </p>
          </Section>

          <Section
            id="cancellation"
            title="10. Cancellation, refunds, and payment failure"
          >
            <p>
              You can cancel from <strong>Settings → Billing</strong> without
              contacting support. Cancel during the trial to avoid the first
              charge. Canceling a paid subscription stops the next renewal, and
              you ordinarily retain access through the period already paid for.
              Deleting a workspace is different: it ends access and cancels an
              associated subscription immediately.
            </p>
            <p>
              Except where required by law or expressly stated in an order form,
              fees are non-refundable and we do not provide credits for partial
              billing periods, unused capacity, downgrades, or unused accounts.
              If payment fails or becomes overdue, we may retry the charge,
              restrict paid features, or suspend access. You remain responsible
              for amounts already due.
            </p>
          </Section>

          <Section
            id="intellectual-property"
            title="11. Intellectual property and feedback"
          >
            <p>
              We and our licensors retain all rights in the hosted Service, its
              branding, documentation, and content other than Customer Content.
              These Terms give you a limited, non-exclusive, non-transferable,
              revocable right to use the hosted Service during your subscription
              in accordance with your plan. They do not grant trademark rights
              or change rights available under an applicable open-source
              license.
            </p>
            <p>
              If you provide feedback, suggestions, or ideas, you grant us a
              perpetual, worldwide, royalty-free right to use them without
              restriction or compensation. This does not transfer ownership of
              Customer Content or confidential information included with
              feedback.
            </p>
          </Section>

          <Section
            id="confidentiality"
            title="12. Confidentiality, privacy, and data protection"
          >
            <p>
              Each party may receive non-public information that is identified
              as confidential or reasonably should be understood to be
              confidential. The receiving party will use it only to perform or
              receive the Service, protect it with reasonable care, and disclose
              it only to people who need it and are bound to protect it. These
              duties do not apply to information that is public through no fault
              of the recipient, already lawfully known, independently developed,
              or lawfully received without confidentiality duties. A recipient
              may disclose information when legally required after giving notice
              where permitted.
            </p>
            <p>
              Our{' '}
              <Link
                href="/privacy"
                className="font-medium text-blue-600 hover:underline"
              >
                Privacy Policy
              </Link>{' '}
              explains how we collect, use, retain, and disclose personal data.
              To the extent answerLoops processes personal data in Customer
              Content on your behalf, you are the controller or business and
              answerLoops is the processor or service provider, unless
              applicable law assigns different roles. Any separately executed
              data processing addendum controls for that processing.
            </p>
          </Section>

          <Section
            id="suspension"
            title="13. Suspension, termination, and deletion"
          >
            <p>
              You may stop using the Service at any time and workspace owners
              may schedule workspace deletion in Settings. Deletion revokes
              access immediately and starts the 30-day restoration period
              described in the Privacy Policy. After that period, workspace data
              is permanently purged, subject to limited backups, legal
              obligations, and records we must retain.
            </p>
            <p>
              We may suspend or terminate access if you materially breach these
              Terms, fail to pay amounts due, create a security or legal risk,
              or use the Service in a way that could harm answerLoops, our
              providers, our users, or third parties. When reasonably possible,
              we will notify you and provide an opportunity to cure before
              suspension or termination. We may act immediately when needed to
              prevent harm, comply with law, or address an urgent security risk.
            </p>
            <p>
              Sections that by their nature should continue after termination
              survive, including payment obligations, ownership,
              confidentiality, warranty disclaimers, liability limits,
              indemnification, and general terms.
            </p>
          </Section>

          <Section id="disclaimers" title="14. Disclaimers">
            <p>
              To the maximum extent permitted by law, the Service, AI outputs,
              trial features, and support are provided &ldquo;as is&rdquo; and
              &ldquo;as available.&rdquo; answerLoops disclaims all express,
              implied, statutory, and other warranties, including warranties of
              merchantability, fitness for a particular purpose, title,
              non-infringement, accuracy, and uninterrupted or error-free
              operation.
            </p>
            <p>
              We do not warrant that an AI output is correct, that every message
              will be detected or delivered, that every integration will remain
              available, that Customer Content will never be lost, or that the
              Service will meet your legal or business requirements. Nothing in
              these Terms excludes a warranty or right that applicable law does
              not allow you to waive.
            </p>
          </Section>

          <Section id="liability" title="15. Limitation of liability">
            <p>
              To the maximum extent permitted by law, neither party will be
              liable under these Terms for indirect, incidental, special,
              consequential, exemplary, or punitive damages, or for lost
              profits, revenues, goodwill, business opportunities, or data, even
              if advised that such damages were possible.
            </p>
            <p>
              To the maximum extent permitted by law, answerLoops&apos; total
              liability arising out of or relating to the Service or these Terms
              will not exceed the greater of US $100 or the fees you paid to
              answerLoops for the Service during the 12 months before the event
              giving rise to liability. These limits apply regardless of the
              legal theory and do not limit liability that cannot lawfully be
              limited.
            </p>
          </Section>

          <Section id="indemnification" title="16. Indemnification">
            <p>
              To the extent permitted by law, you will defend, indemnify, and
              hold harmless answerLoops and its personnel from third-party
              claims, damages, losses, and reasonable costs arising from
              Customer Content, your use of the Service in violation of these
              Terms or law, or your infringement or violation of another
              person&apos;s rights. We will promptly notify you of a covered
              claim, allow you to control the defense and settlement, and
              reasonably cooperate at your expense. You may not settle a claim
              in a way that admits fault by or imposes obligations on
              answerLoops without our written consent.
            </p>
          </Section>

          <Section id="general" title="17. General terms">
            <p>
              <strong>Changes.</strong> We may update these Terms. We will post
              the revised Terms and update the effective date, and we will
              provide reasonable advance notice of material changes. Changes
              take effect on the date stated in the notice. If you continue
              using the Service after they take effect, you accept the revised
              Terms; if you do not agree, you must stop using the Service and
              cancel before the changes apply.
            </p>
            <p>
              <strong>Notices.</strong> We may send notices to the email
              associated with your account, through the Service, or by posting
              them on our website. You are responsible for keeping your email
              address current.
            </p>
            <p>
              <strong>Assignment.</strong> You may not assign these Terms
              without our written consent. We may assign them in connection with
              a merger, acquisition, reorganization, sale of assets, or by
              operation of law.
            </p>
            <p>
              <strong>Force majeure.</strong> Neither party is liable for delay
              or failure caused by events beyond its reasonable control, except
              for payment obligations.
            </p>
            <p>
              <strong>Entire agreement; severability; waiver.</strong> These
              Terms, the Privacy Policy, any applicable order form, and any
              other terms expressly incorporated by reference are the entire
              agreement about the Service. If a provision is unenforceable, it
              will be limited to the minimum extent necessary and the rest will
              remain effective. A failure to enforce a provision is not a
              waiver.
            </p>
            <p>
              <strong>Relationship.</strong> The parties are independent
              contractors. These Terms do not create a partnership, joint
              venture, agency, fiduciary, franchise, or employment relationship,
              and they do not give rights to third-party beneficiaries.
            </p>
          </Section>

          <Section id="contact" title="18. Contact">
            <p>
              Questions about these Terms:{' '}
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
