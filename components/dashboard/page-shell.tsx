import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The frame every dashboard page sits in: one width and one vertical rhythm,
 * so moving between pages does not shift the layout.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="dashboard-page max-w-6xl space-y-6">{children}</div>
}

/**
 * Title, one line of description, and the page's actions on the right. `back`
 * is for detail views that sit under a list.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
}) {
  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900">
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  )
}
