import { auth } from '@/auth'
import { listWidgetLeads } from '@/lib/db/queries/widget-leads'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { LockedCsvExportButton } from '@/components/billing/locked-csv-export-button'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const canExportCsv = await orgHasFeature(orgId, 'csv_export')
  const leads = await listWidgetLeads(orgId)

  return (
    <div className="dashboard-page max-w-6xl space-y-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-blue-600">
            <span className="h-px w-6 bg-blue-500" />
            Demand capture
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Widget Leads</h1>
          <p className="mt-1 text-sm text-slate-500">{leads.length} email{leads.length !== 1 ? 's' : ''} collected while support conversations were active.</p>
        </div>
        {canExportCsv ? (
          <a
            href="/api/export/leads"
            className="flex items-center gap-1.5 self-start rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-700"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </a>
        ) : (
          <LockedCsvExportButton className="flex items-center gap-1.5 self-start rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-700" />
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 mb-3">
              <svg className="h-6 w-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700">No leads yet</p>
            <p className="text-xs text-gray-400 mt-1">Emails collected from your chat widget appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Question</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-gray-800">{lead.email}</td>
                  <td className="px-5 py-3 text-gray-500 max-w-xs truncate" title={lead.question ?? undefined}>
                    {lead.question ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {new Date(lead.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
