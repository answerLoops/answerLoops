export function WorkflowDiagram() {
  return (
    <figure aria-label="How answerLoops drafts and reviews a support reply">
      <ol className="marketing-workflow">
        {[
          [
            '01 / Receive',
            'Keep the conversation attached',
            'A question becomes a ticket with its channel and original message.',
          ],
          [
            '02 / Draft',
            'Use your documentation',
            'answerLoops retrieves relevant knowledge and drafts a reply with its sources.',
          ],
          [
            '03 / Review',
            'Check the proposed answer',
            'A separate AI review assesses the draft. Your channel settings determine the next step.',
          ],
        ].map(([label, title, body]) => (
          <li key={label} className="marketing-workflow-step">
            <p className="marketing-eyebrow">{label}</p>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
      <div className="marketing-workflow-outcomes">
        <div>
          <h3>Automatic reply</h3>
          <p>When enabled, qualifying answers post in the source channel.</p>
        </div>
        <div>
          <h3>Team review</h3>
          <p>
            Your team reviews, edits, or answers tickets that need attention.
          </p>
        </div>
      </div>
      <figcaption className="marketing-note">
        Save useful resolutions to the knowledge base so future drafts can use
        them.
      </figcaption>
    </figure>
  )
}
