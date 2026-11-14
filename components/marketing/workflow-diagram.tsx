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
    label: '01 / Question',
    title: 'A question is asked in your community',
    body: 'A member posts a question in your Discord, Slack, Discourse, or another connected community channel. answerLoops picks it up and saves it as a ticket, with the full conversation attached.',
    tone: 'channel',
    avatar: <MessageSquare size={24} strokeWidth={1.8} />,
  },
  {
    label: '02 / answerLoops agent',
    title: 'The answerLoops agent writes an answer from your docs',
    body: 'It searches your knowledge base for the articles that cover the question and writes a reply that cites them.',
    tone: 'answer',
    avatar: <BotMessageSquare size={28} strokeWidth={1.8} />,
  },
  {
    label: '03 / Review agent',
    title: 'A second agent verifies the answer',
    body: 'A separate Review agent checks the reply against those same articles and scores how confident it is that the answer is correct. Then the answer goes one of two ways.',
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
          <h3>Your team approves it (default)</h3>
          <p>
            Nothing is posted until someone on your team approves it. Approve
            the answer, edit it, or write your own.
          </p>
        </div>
        <div>
          <h3>It posts automatically (optional)</h3>
          <p>
            Off until you turn it on for a channel. Then only answers the
            Review agent is confident in post on their own. The rest still go
            to your team.
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
