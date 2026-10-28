import Link from 'next/link'
import { OUTCOME_LABEL, SOURCE_STATUS } from '@/lib/kb/answer-labels'
import type { KBAnswerSourceStatus, KBTicketAnswerSources } from '@/types'

const STATUS_STYLE: Record<KBAnswerSourceStatus, { icon: string; tone: string }> = {
  current: { icon: '✓', tone: 'text-emerald-700' },
  changed: { icon: '!', tone: 'text-amber-700' },
  unpublished: { icon: '–', tone: 'text-slate-600' },
  deleted: { icon: '×', tone: 'text-red-700' },
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * The knowledge-base articles that were supplied as context for a ticket's
 * draft, in the order they were given, each with where it stands now. Shown to
 * owners and admins only (the page decides). It is a record of what was
 * supplied, never of what the reply used: the assistant decides that.
 */
export function AnswerSourcesPanel({ data }: { data: KBTicketAnswerSources }) {
  return (
    <section aria-labelledby="answer-sources-heading" className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 id="answer-sources-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Sources
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        Articles supplied as context for this draft, in the order they were given. The assistant decides what to use, so
        this does not mean the reply quoted them.
      </p>

      {data.outcome === 'failed' && (
        <p className="mt-2 text-xs text-amber-700">The draft failed. These are the articles that were supplied to it.</p>
      )}

      {data.sources.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No knowledge-base articles were supplied for this draft.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {data.sources.map((s, i) => {
            const style = STATUS_STYLE[s.status]
            const linked = s.article_id !== null && (s.status === 'current' || s.status === 'changed')
            const title = s.title ?? 'Deleted article'
            return (
              <li key={`${s.rank}-${s.article_id ?? `gone-${i}`}`} className="flex min-w-0 gap-3 text-sm">
                <span className="w-5 shrink-0 text-right tabular-nums text-slate-500" aria-hidden="true">
                  {s.rank}.
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-gray-900">
                    <span className="sr-only">Position {s.rank}: </span>
                    {linked ? (
                      <Link href={`/kb#article-${s.article_id}`} className="text-brand-600 hover:underline">
                        {title}
                      </Link>
                    ) : (
                      title
                    )}
                  </p>
                  <p className={`break-words text-xs ${style.tone}`}>
                    <span aria-hidden="true">{style.icon} </span>
                    <span className="font-medium">{SOURCE_STATUS[s.status].label}</span>
                    <span className="text-slate-600"> · {SOURCE_STATUS[s.status].detail}</span>
                  </p>
                  {s.copies > 0 && (
                    <p className="break-words text-xs text-slate-600">
                      {s.copies === 1
                        ? 'An identical copy of this article was also supplied.'
                        : `${s.copies} identical copies of this article were also supplied.`}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-3 text-xs text-slate-500">
        {OUTCOME_LABEL[data.outcome]} · <time dateTime={data.created_at}>{formatWhen(data.created_at)}</time>
      </p>
    </section>
  )
}
