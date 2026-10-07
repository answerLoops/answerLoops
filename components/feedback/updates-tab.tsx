import { formatBoardDate } from '@/lib/product-feedback/dates'
import type { BoardUpdate } from '@/lib/product-feedback/validation'

export function UpdatesTab({ updates }: { updates: BoardUpdate[] }) {
  return (
    <div className="p-3">
      {updates.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No updates yet. New releases will show up here.</p>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => (
            <li key={u.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <p className="break-words text-sm font-semibold text-slate-900">{u.title}</p>
              <p className="text-xs text-slate-500">{formatBoardDate(u.publishedAt)}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{u.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
