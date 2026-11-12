import { Bot, BotMessageSquare, MessageSquare, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

type Step = {
  label: string
  title: string
  body: string
  tone: 'channel' | 'answer' | 'review'
  avatar: ReactNode
}

// Steps 02 and 03 are the two AI agents, so each gets a robot avatar. The
// review agent's avatar carries a check badge so the two read as different
// agents at a glance.
const STEPS: Step[] = [
  {
    label: '01 / Receive',
    title: 'Keep the conversation attached',
    body: 'A question becomes a help ticket with its channel and original message.',
    tone: 'channel',
    avatar: <MessageSquare size={24} strokeWidth={1.8} />,
  },
  {
    label: '02 / answerLoops agent',
    title: 'Write the answer from your knowledge base',
    body: 'The answerLoops agent finds the relevant articles in your knowledge base and writes a reply that cites them.',
    tone: 'answer',
    avatar: <BotMessageSquare size={28} strokeWidth={1.8} />,
  },
  {
    label: '03 / Review agent',
    title: 'A Review agent checks the answer',
    body: 'A separate Review agent checks the answer against those sources and scores its confidence. Then the answer takes one of the two paths below.',
    tone: 'review',
    avatar: (
      <>
        <Bot size={28} strokeWidth={1.8} />
        <span className="marketing-agent-badge">
          <ShieldCheck size={14} strokeWidth={2.2} />
        </span>
      </>
    ),
  },
]

export function WorkflowDiagram() {
  return (
    <figure aria-label="How answerLoops writes and reviews a support reply">
      <ol className="marketing-workflow">
        {STEPS.map(({ label, title, body, tone, avatar }) => (
          <li key={label} className="marketing-workflow-step">
            <p className="marketing-eyebrow marketing-workflow-label">
              <span
                className="marketing-agent-avatar"
                data-tone={tone}
                aria-hidden="true"
              >
                {avatar}
              </span>
              {label}
            </p>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
      <div className="marketing-workflow-outcomes">
        <div>
          <h3>Team review (default)</h3>
          <p>
            Every answer waits in your team’s queue. Approve it, edit it, or
            write your own before anything is posted.
          </p>
        </div>
        <div>
          <h3>Automatic reply (optional)</h3>
          <p>
            Off until you turn it on for a channel. Then answers that pass the
            review with high confidence post on their own.
          </p>
        </div>
      </div>
      <figcaption className="marketing-note">
        Save useful resolutions to the knowledge base so future answers can use
        them.
      </figcaption>
    </figure>
  )
}
