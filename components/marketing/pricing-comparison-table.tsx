/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Horizontal scroll regions need keyboard focus so arrow keys can reveal every column. */
import { Fragment } from 'react'
import { rateLimitPerMinute } from '@/lib/billing/entitlements'
type Cell = boolean | string
interface Row {
  feature: string
  standard: Cell
  pro: Cell
  enterprise: Cell
}
interface Group {
  title: string
  rows: Row[]
}

/*
 * Features that are identical on every plan. They used to be table rows that
 * read "Included, Included, Included", which buried the rows that actually
 * differ. They are listed once, below the table, instead.
 */
const IN_EVERY_PLAN = [
  'Discord, Slack, Discourse, Circle, GitHub, Telegram, Email, and Google Chat',
  'Website chat widget with lead capture',
  'Knowledge base from files, URLs, GitHub, and Notion',
  'Supported AI provider accounts',
  'MCP server and REST Agent API',
  'Multi-language AI responses',
  'CSV export',
]

/* Only rows that differ between plans belong here. */
const GROUPS: Group[] = [
  {
    title: 'Usage',
    rows: [
      {
        feature: 'Estimated AI replies / month',
        standard: '500',
        pro: '3,000',
        enterprise: 'Unlimited',
      },
      {
        feature: 'Usage beyond the monthly limit',
        standard: 'Pauses at 500',
        pro: '$5 per 100',
        enterprise: '—',
      },
      {
        feature: 'MCP / Agent API rate limit',
        standard: `${rateLimitPerMinute('standard')} req/min`,
        pro: `${rateLimitPerMinute('pro')} req/min`,
        enterprise: `${rateLimitPerMinute('enterprise')} req/min`,
      },
    ],
  },
  {
    title: 'Added in Pro',
    rows: [
      {
        feature: 'White-label widget (remove branding)',
        standard: false,
        pro: true,
        enterprise: true,
      },
      {
        feature: 'Customer satisfaction ratings',
        standard: false,
        pro: true,
        enterprise: true,
      },
      {
        feature: 'Automatic escalation routing',
        standard: false,
        pro: true,
        enterprise: true,
      },
      {
        feature: 'Simulation / dry-run mode',
        standard: false,
        pro: true,
        enterprise: true,
      },
      {
        feature: 'Knowledge gap dashboard',
        standard: false,
        pro: true,
        enterprise: true,
      },
      {
        feature: 'Knowledge base review queue',
        standard: false,
        pro: true,
        enterprise: true,
      },
      {
        feature: 'Priority support',
        standard: false,
        pro: true,
        enterprise: true,
      },
    ],
  },
  {
    title: 'Added in Enterprise',
    rows: [
      {
        feature: 'Custom model endpoints',
        standard: false,
        pro: false,
        enterprise: true,
      },
      {
        feature: 'Unlimited data retention',
        standard: false,
        pro: false,
        enterprise: true,
      },
      {
        feature: 'Migration assistance',
        standard: false,
        pro: false,
        enterprise: true,
      },
      {
        feature: 'SLA + automatic breach alerting',
        standard: false,
        pro: false,
        enterprise: true,
      },
      {
        feature: 'Custom invoicing',
        standard: false,
        pro: false,
        enterprise: true,
      },
    ],
  },
]

const PLAN_KEYS = ['standard', 'pro', 'enterprise'] as const

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  )
}

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <span className="pricing-compare-yes">
        <CheckIcon />
        <span className="sr-only">Included</span>
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="pricing-compare-no">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not included</span>
      </span>
    )
  }
  return <span>{value}</span>
}

export function PricingComparisonTable() {
  return (
    <>
      <div
        className="marketing-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Plan comparison; scroll horizontally on small screens"
      >
        <table className="marketing-table pricing-compare">
          <caption className="sr-only">
            Where the hosted plans differ
          </caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Standard</th>
              <th scope="col" className="pricing-compare-pro">
                Pro
              </th>
              <th scope="col">Enterprise</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((group) => (
              <Fragment key={group.title}>
                <tr className="pricing-compare-group">
                  <th scope="colgroup" colSpan={4}>
                    {group.title}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row" className="!bg-white">
                      {row.feature}
                    </th>
                    {PLAN_KEYS.map((plan) => (
                      <td
                        key={plan}
                        className={
                          plan === 'pro' ? 'pricing-compare-pro' : undefined
                        }
                      >
                        <CellValue value={row[plan]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="marketing-note lg:hidden">
        Scroll the table horizontally to compare all plans.
      </p>
      <div className="pricing-compare-included">
        <h3>In every plan</h3>
        <ul>
          {IN_EVERY_PLAN.map((item) => (
            <li key={item}>
              <span className="pricing-compare-yes">
                <CheckIcon />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
