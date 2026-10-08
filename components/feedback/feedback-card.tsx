import { formatBoardDate } from '@/lib/product-feedback/dates'
import { REPLY_TAG_LABELS, type BoardFeedback } from '@/lib/product-feedback/validation'
import { LogoMark } from '@/components/logo'
import { ChatIcon, ThumbIcon } from './feedback-icons'

const STATUS_NOTE: Record<BoardFeedback['status'], string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Not approved',
}

export function FeedbackCard({ item }: { item: BoardFeedback }) {
  const stamp =
    item.status === 'approved' && item.approvedAt
      ? `Approved ${formatBoardDate(item.approvedAt)}`
      : `${STATUS_NOTE[item.status]} · ${formatBoardDate(item.createdAt)}`

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
            <ChatIcon />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{item.authorLabel}</p>
            <p className="text-xs text-slate-500">{stamp}</p>
          </div>
        </div>

        <p className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{item.body}</p>

        {(item.mine || item.status !== 'approved') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.mine && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                You
              </span>
            )}
            {item.status !== 'approved' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                {STATUS_NOTE[item.status]}
              </span>
            )}
          </div>
        )}
      </div>

      {item.reply && (
        <div className="border-t border-slate-200 bg-slate-50 py-3.5 pl-7 pr-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-l-2 border-indigo-200 pl-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <LogoMark size={18} />
            </div>
            <p className="min-w-0 text-sm font-semibold text-slate-900">Nathan @ answerLoops</p>
            {item.reply.tag && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                <ThumbIcon className="h-3 w-3" />
                {REPLY_TAG_LABELS[item.reply.tag]}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-indigo-200 pl-3 text-sm leading-relaxed text-slate-700">
            {item.reply.body}
          </p>
        </div>
      )}
    </li>
  )
}
