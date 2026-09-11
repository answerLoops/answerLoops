import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ORDERED_PLANS, TRIAL_DAYS } from '@/lib/billing/plans'
import { PricingToggle } from '@/components/marketing/pricing-toggle'
import { PricingComparisonTable } from '@/components/marketing/pricing-comparison-table'
import {
  MarketingPage,
  PageHero,
  TrialCta,
} from '@/components/marketing/layout'
import { PageSchema } from '@/components/marketing/page-schema'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { PRICING_FAQ } from '@/lib/marketing/pricing'
import { ORGANIZATION_ID } from '@/lib/site-identity'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Pricing — AnswerLoops',
  description:
    'Compare Standard, Pro, and Enterprise plans. See exact monthly and annual prices, automated-answer allowances, model costs, and trial terms.',
  alternates: { canonical: '/pricing' },
}
function PricingStructuredData() {
  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AnswerLoops',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: 'https://answerloops.com/pricing',
    provider: { '@id': ORGANIZATION_ID },
    description:
      'Hosted support plans with included automated answers and a 14-day trial.',
    offers: [
      {
        '@type': 'Offer',
        name: 'Self-hosted',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        description: 'Open-source platform running on your own infrastructure.',
      },
      ...ORDERED_PLANS.map((plan) => ({
        '@type': 'Offer',
        name: plan.name,
        price: (plan.priceMonthly / 100).toString(),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: (plan.priceMonthly / 100).toString(),
          priceCurrency: 'USD',
          billingDuration: 'P1M',
        },
        description:
          plan.deflectionsPerMonth === null
            ? 'Unlimited deflections per month with a 14-day hosted trial.'
            : `${plan.deflectionsPerMonth.toLocaleString()} deflections per month with a 14-day hosted trial.`,
      })),
    ],
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PRICING_FAQ.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }

  return (
    <>
      {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml */}
      {/* softwareJsonLd/faqJsonLd are built from server-controlled strings (plan names, FAQ copy), never user input; jsonLdHtml escapes `<` so the payload can't break out of the script tag. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd) }}
      />
    </>
  )
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string; checkout?: string }>
}) {
  const { resume, checkout } = await searchParams
  const navState = await resolveNavState()
  if (resume === '1' && navState === 'active') redirect('/dashboard')
  return (
    <MarketingPage navState={navState}>
      <PageSchema
        name="AnswerLoops pricing"
        description={metadata.description!}
        path="/pricing"
      />
      <PricingStructuredData />
      <PageHero
        eyebrow="Pricing"
        title="Choose a plan for your support volume."
      >
        <p>
          A subscription includes a monthly allowance of automated answers. Add
          teammates without per-seat fees. Choose monthly billing or save 20%
          with an annual subscription.
        </p>
      </PageHero>
      <section id="plans" className="marketing-section scroll-mt-24">
        <div className="marketing-container">
          {checkout === 'failed' && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 p-5"
            >
              <p className="font-medium">We couldn’t start checkout.</p>
              <p className="mt-1 text-sm">
                Nothing was charged. Try again below, or{' '}
                <a className="underline" href="mailto:hello@answerloops.com">
                  contact us
                </a>{' '}
                for help.
              </p>
            </div>
          )}
          {resume === '1' &&
            checkout !== 'failed' &&
            navState === 'no-plan' && (
              <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-5">
                <p className="font-medium">
                  You’re signed in — pick a plan to finish setting up.
                </p>
                <p className="mt-1 text-sm">
                  A card is required to start your {TRIAL_DAYS}-day trial.
                  Nothing is charged today.
                </p>
              </div>
            )}
          <PricingToggle plans={ORDERED_PLANS} />
          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h3>Plan your total cost</h3>
            <p className="mt-2 text-slate-600">
              New hosted workspaces include five AI-processed tickets without a
              provider key. After that, connect your provider and pay its model
              usage directly. This one-time allowance is separate from your
              14-day plan trial and monthly answer allowance.
            </p>
            <Link
              className="marketing-text-link mt-4"
              href="/docs/product/ai-config"
            >
              Provider and model requirements →
            </Link>
          </div>
        </div>
      </section>
      <section
        id="comparison"
        className="marketing-section marketing-soft scroll-mt-24"
      >
        <div className="marketing-container">
          <h2>Compare features and limits</h2>
          <p className="marketing-lead">
            Every plan includes the knowledge base, support queue, website
            widget, and MCP and REST API access.
          </p>
          <PricingComparisonTable />
          <p className="marketing-note">
            For SSO, audit logs, retention, DPA or BAA requirements, and service
            commitments,{' '}
            <a href="mailto:hello@answerloops.com" className="underline">
              contact our team
            </a>{' '}
            to define your enterprise agreement.
          </p>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container marketing-reading">
          <h2>Billing and trial questions</h2>
          <div className="marketing-faq">
            {PRICING_FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
          <p className="marketing-note">
            Prefer to operate the software yourself?{' '}
            <Link href="/self-hosted-ai-support" className="underline">
              Read about self-hosting.
            </Link>
          </p>
        </div>
      </section>
      <TrialCta title="Start with your own support questions." />
    </MarketingPage>
  )
}
