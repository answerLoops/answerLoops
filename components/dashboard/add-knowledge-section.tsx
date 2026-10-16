'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { addKnowledgeAction, type AddKnowledgeState } from '@/lib/actions/kb'

const QUESTION_MAX = 500
const ANSWER_MAX = 8000

/**
 * Lets the team write context straight into the knowledge base: a question (or
 * title) and the answer. It is saved as a published article and starts
 * answering immediately, so there is no draft step here — the review queue is
 * where unreviewed answers wait.
 */
export interface KnowledgeDraft {
  /** The ticket the article is written from; saved with it so the gap closes. */
  ticketId: number
  question: string
  answer: string
}

export function AddKnowledgeSection({
  onAdded,
  draft,
  onDraftConsumed,
}: {
  onAdded?: () => void
  /** Starting text, for an article written from a ticket. */
  draft?: KnowledgeDraft | null
  /** Called once the drafted article is saved, so the caller can drop the draft. */
  onDraftConsumed?: () => void
}) {
  // Controlled, because React resets an uncontrolled form after every action —
  // including a failed one, which would throw away what the person just typed.
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sourceTicketId, setSourceTicketId] = useState<number | null>(null)

  // A new draft replaces the fields once, while rendering, rather than in an
  // effect, so the form never paints the old text first.
  const [appliedDraft, setAppliedDraft] = useState<KnowledgeDraft | null>(null)
  if (draft && draft !== appliedDraft) {
    setAppliedDraft(draft)
    setQuestion(draft.question)
    setAnswer(draft.answer)
    setSourceTicketId(draft.ticketId)
  }

  const [state, formAction, pending] = useActionState(
    async (prev: AddKnowledgeState, formData: FormData): Promise<AddKnowledgeState> => {
      const result = await addKnowledgeAction(prev, formData)
      if (result && 'ok' in result) {
        setQuestion('')
        setAnswer('')
        // Read from what was submitted, not from state, so this holds whichever
        // render the action closure came from.
        if (formData.has('sourceTicketId')) {
          setSourceTicketId(null)
          onDraftConsumed?.()
        }
        onAdded?.()
      }
      return result
    },
    null
  )

  const canSubmit = question.trim() !== '' && answer.trim() !== '' && !pending

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"
      aria-labelledby="add-knowledge-heading"
    >
      <h2 id="add-knowledge-heading" className="text-sm font-semibold text-slate-900">
        Write an answer by hand
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Write down something the assistant should know. It starts answering questions straight away, so leave out
        names and account details.
      </p>

      <form action={formAction} className="mt-3 space-y-3">
        {sourceTicketId !== null && <input type="hidden" name="sourceTicketId" value={sourceTicketId} />}
        {sourceTicketId !== null && (
          <p role="status" className="text-xs text-slate-600">
            Started from a ticket. Edit the question and answer, then add it to close the gap.
          </p>
        )}
        <div>
          <label htmlFor="add-knowledge-question" className="text-xs font-medium text-slate-600">
            Question or title
          </label>
          <input
            id="add-knowledge-question"
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={QUESTION_MAX}
            placeholder="e.g. Do you ship to Canada?"
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="add-knowledge-answer" className="text-xs font-medium text-slate-600">
            Answer or context
          </label>
          <textarea
            id="add-knowledge-answer"
            name="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={ANSWER_MAX}
            rows={5}
            placeholder="Write the answer as you would tell a customer."
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-right text-[0.6875rem] tabular-nums text-slate-400">
            {answer.length} / {ANSWER_MAX}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {pending ? 'Adding…' : 'Add to knowledge base'}
          </Button>
          {state && 'ok' in state && (
            <p role="status" className="min-w-0 break-words text-xs text-emerald-700">
              Added. The assistant can use it straight away.
            </p>
          )}
          {state && 'error' in state && (
            <p role="alert" className="min-w-0 break-words text-xs text-red-600">
              {state.error}
            </p>
          )}
        </div>
      </form>
    </section>
  )
}
