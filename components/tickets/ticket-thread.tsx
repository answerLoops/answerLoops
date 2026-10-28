import { TicketContent } from '@/components/tickets/ticket-content'
import { LocalDate } from '@/components/ui/local-date'
import { buildTicketThread, threadRoleLabel, type ThreadEntryRole } from '@/lib/tickets/thread'
import type { TicketReply } from '@/types'

const ROLE_STYLE: Record<ThreadEntryRole, string> = {
  customer: 'bg-amber-50 text-amber-700',
  staff: 'bg-blue-50 text-blue-700',
  context: 'bg-gray-100 text-gray-600',
  ai: 'bg-brand-50 text-brand-700',
}

// The conversation after the opening message, in order, for every channel.
export function TicketThread({ replies }: { replies: TicketReply[] }) {
  const entries = buildTicketThread(replies)
  if (entries.length === 0) return null

  return (
    <section aria-label="Conversation" className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Conversation · {entries.length} {entries.length === 1 ? 'message' : 'messages'}
      </h2>
      <ol className="space-y-3">
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-role={entry.role}
            className={`min-w-0 rounded-lg border p-4 ${entry.role === 'context' ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-medium text-gray-700">{entry.author}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_STYLE[entry.role]}`}>
                  {threadRoleLabel(entry.role)}
                </span>
              </span>
              <span className="text-xs text-gray-400"><LocalDate iso={entry.createdAt} time /></span>
            </div>
            <div className="break-words">
              <TicketContent content={entry.content} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
