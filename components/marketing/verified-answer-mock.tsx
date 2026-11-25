import { Check, MessageSquare, ShieldCheck } from 'lucide-react'

// The home page's version of the community reply flow. WorkflowDiagram keeps
// the full card layout for the deeper pages; here the steps sit beside a
// picture of the result so the section reads differently from its neighbours.
const STEPS = [
  {
    title: 'A member asks a question in your community',
    body: 'In Discord, Slack, or another connected channel. answerLoops saves it as a ticket with the full conversation.',
  },
  {
    title: 'answerLoops writes an answer from your docs',
    body: 'It finds the knowledge-base articles that cover the question and cites them in the reply.',
  },
  {
    title: 'A second AI agent verifies the answer',
    body: 'The Review agent checks the reply against those same articles and scores how confident it is.',
  },
]

export function VerifiedAnswerSteps() {
  return (
    <>
      <ol className="chat-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="chat-steps-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="chat-steps-miss">
        <strong>Then your team decides.</strong> By default nothing is posted
        until someone approves, edits, or dismisses the answer. Turn on
        auto-reply for a channel and only answers the Review agent is confident
        in post on their own. The rest still come to your team.
      </p>
    </>
  )
}

/**
 * A static picture of one ticket after both agents have run: the member's
 * question, the cited draft, the Review agent's checks and confidence, and the
 * Approve / Edit / Dismiss actions the ticket page offers. Content uses the
 * same demo workspace as the product screenshots further down the page.
 */
export function VerifiedAnswerMock() {
  return (
    <figure
      className="verify-mock"
      aria-label="A drafted answer with cited sources, checked by the Review agent and waiting for team approval"
    >
      <div className="verify-mock-stage" aria-hidden="true">
        <div className="verify-mock-card">
          <div className="verify-mock-head">
            <span className="verify-mock-channel">
              <MessageSquare size={13} strokeWidth={2.2} />
              Discord · #help
            </span>
            <span className="verify-mock-status">Waiting for your team</span>
          </div>

          <div className="verify-mock-question">
            <span className="verify-mock-avatar">M</span>
            <div>
              <p className="verify-mock-author">maya_builds</p>
              <p>
                Can I power the arm from a 3S LiPo, or will it fry the servos?
              </p>
            </div>
          </div>

          <div className="verify-mock-draft">
            <p className="verify-mock-label">AI draft answer</p>
            <p>
              Not directly. The servo board is rated for 2S (8.4V) at most
              <sup>1</sup>. Put the included 5V regulator between a 3S pack and
              the board, then recalibrate<sup>2</sup>.
            </p>
            <ul className="verify-mock-sources">
              <li>
                <span>1</span>Power requirements
              </li>
              <li>
                <span>2</span>Wiring the regulator
              </li>
            </ul>
          </div>

          <div className="verify-mock-actions">
            <span className="verify-mock-approve">Approve</span>
            <span>Edit</span>
            <span>Dismiss</span>
          </div>
        </div>

        <div className="verify-mock-review">
          <div className="verify-mock-review-head">
            <span className="verify-mock-shield">
              <ShieldCheck size={15} strokeWidth={2.2} />
            </span>
            <div>
              <p className="verify-mock-review-title">Review agent</p>
              <p className="verify-mock-review-sub">Checked against 2 articles</p>
            </div>
          </div>
          <ul className="verify-mock-checks">
            <li>
              <Check size={13} strokeWidth={2.6} />
              2S limit matches source 1
            </li>
            <li>
              <Check size={13} strokeWidth={2.6} />
              Regulator steps match source 2
            </li>
          </ul>
          <div className="verify-mock-meter">
            <div>
              <span>Confidence</span>
              <strong>94%</strong>
            </div>
            <i>
              <b style={{ width: '94%' }} />
            </i>
          </div>
        </div>
      </div>
    </figure>
  )
}
