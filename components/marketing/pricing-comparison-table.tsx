/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Horizontal scroll regions need keyboard focus so arrow keys can reveal every column. */
import { rateLimitPerMinute } from '@/lib/billing/entitlements'
type Cell = boolean | string
interface Row {
  feature: string
  standard: Cell
  pro: Cell
  enterprise: Cell
}
const ROWS: Row[] = [
  {
    feature: 'Automated answers / month',
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
    feature:
      'Discord, Slack, Discourse, Circle, GitHub, Telegram, Email, Google Chat',
    standard: true,
    pro: true,
    enterprise: true,
  },
  {
    feature: 'Website chat widget + lead capture',
    standard: true,
    pro: true,
    enterprise: true,
  },
  {
    feature: 'Knowledge base (files, URLs, GitHub, Notion)',
    standard: true,
    pro: true,
    enterprise: true,
  },
  {
    feature: 'Supported AI provider accounts',
    standard: true,
    pro: true,
    enterprise: true,
  },
  {
    feature: 'MCP server + REST Agent API',
    standard: true,
    pro: true,
    enterprise: true,
  },
  {
    feature: 'MCP / Agent API rate limit',
    standard: `${rateLimitPerMinute('standard')} req/min`,
    pro: `${rateLimitPerMinute('pro')} req/min`,
    enterprise: `${rateLimitPerMinute('enterprise')} req/min`,
  },
  {
    feature: 'Multi-language AI responses',
    standard: true,
    pro: true,
    enterprise: true,
  },
  { feature: 'CSV export', standard: true, pro: true, enterprise: true },
  {
    feature: 'White-label widget (remove branding)',
    standard: true,
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
  { feature: 'Priority support', standard: false, pro: true, enterprise: true },
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
]

function CellValue({ value }: { value: Cell }) {
  return (
    <span>
      {typeof value === 'boolean'
        ? value
          ? 'Included'
          : 'Not included'
        : value}
    </span>
  )
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
        <table className="marketing-table">
          <caption className="sr-only">
            Features included in each hosted plan
          </caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Standard</th>
              <th scope="col">Pro</th>
              <th scope="col">Enterprise</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.feature}>
                <th scope="row" className="!bg-white">
                  {row.feature}
                </th>
                {(['standard', 'pro', 'enterprise'] as const).map((plan) => (
                  <td key={plan}>
                    <CellValue value={row[plan]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="marketing-note lg:hidden">
        Scroll the table horizontally to compare all plans.
      </p>
    </>
  )
}
