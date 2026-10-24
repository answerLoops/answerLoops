/**
 * Documentation screenshots of the real app, captured against the seeded demo
 * workspace by `pnpm docs:shots` (see capture.ts and README.md, "Screenshots").
 *
 * Selectors are Playwright selectors (CSS, `text=`, `:has-text()`, `xpath=`).
 * A pin selector must match a visible element on the screen; the capture fails
 * loudly otherwise, so a UI refactor is caught instead of producing a pin that
 * points at nothing.
 */

export interface ViewportSize {
  width: number
  height: number
}

/** A step run after the page loads and before the screenshot. Keep these minimal. */
export type ShotAction =
  | { click: string }
  | { fill: string; value: string }
  /** Scroll the page's main column so this element sits near the top. */
  | { scrollTo: string }
  | { waitFor: string }

export type ShotCapture =
  | { type: 'viewport' }
  /** Crop to one element's bounding box (pin coordinates are relative to it). */
  | { type: 'element'; selector: string }
  /** Crop to a rectangle in viewport CSS pixels. */
  | { type: 'clip'; x: number; y: number; width: number; height: number }

export interface ShotPin {
  /** kebab-case, unique within the shot */
  id: string
  selector: string
  /** Short human label, shown in the legend next to the numbered pin. */
  label: string
}

/** Replace the text of, or blur, every element matching `selector`. */
export interface ShotMask {
  selector: string
  mode: 'replace' | 'blur'
  /** Replacement text for mode 'replace'. Defaults to a row of bullets. */
  text?: string
}

/** Rewrite any visible text matching a regular expression. */
export interface TextMaskRule {
  pattern: string
  flags?: string
  replacement: string
}

export interface Shot {
  /** kebab-case; becomes public/docs/shots/<id>.webp and the JSON key */
  id: string
  route: string
  /** Defaults to 1440x900. Raise the height to include more of a long page. */
  viewport?: ViewportSize
  actions?: ShotAction[]
  /** Selectors that must be visible before capture. */
  waitFor: string[]
  /** Defaults to the whole viewport. */
  capture?: ShotCapture
  alt: string
  /** 3 to 6 of the most important regions on the screen. */
  pins: ShotPin[]
  /** Extra element masks for this shot. */
  mask?: ShotMask[]
  /** Extra text rules for this shot, on top of DEFAULT_TEXT_MASKS. */
  textMask?: TextMaskRule[]
  /** Keep the floating product-feedback widget (hidden by default). */
  keepFeedbackWidget?: boolean
}

export const DEFAULT_VIEWPORT: ViewportSize = { width: 1440, height: 900 }

/**
 * Applied to every shot, whether or not it appears on screen. Seeded
 * credentials are random, so their last characters (and the Circle setup value,
 * the widget embed token and API key prefixes) must never reach an image.
 */
export const DEFAULT_TEXT_MASKS: TextMaskRule[] = [
  // "••••30b1 (connected)": the last four characters of a stored token.
  { pattern: '[•·]{2,}\\s?[A-Za-z0-9]{4}\\b', replacement: '••••••••' },
  // Long hex values: Circle setup value, widget embed token.
  { pattern: '\\b[0-9a-f]{24,}\\b', replacement: '••••••••••••••••' },
  // "al_live_<8 hex>••••••••": API key prefixes.
  { pattern: '\\bal_live_[0-9a-f]{4,}', replacement: 'al_live_••••••••' },
]

export const SHOTS: Shot[] = [
  {
    id: 'dashboard',
    route: '/dashboard',
    viewport: { width: 1440, height: 980 },
    waitFor: ['h1:has-text("Good to see you")', '.dashboard-stats'],
    alt: 'The answerLoops dashboard: ticket counts for auto-answered, open, in progress and resolved tickets, with the open tickets list and SLA status below.',
    pins: [
      { id: 'navigation', selector: 'aside.dashboard-sidebar', label: 'Navigation sidebar' },
      { id: 'stat-cards', selector: '.dashboard-stats', label: 'Ticket counts at a glance' },
      { id: 'auto-answered', selector: 'a:has-text("Auto-Answered")', label: 'Auto-answered tickets' },
      { id: 'open-tickets', selector: 'h2:text-is("Open tickets") >> xpath=ancestor::div[3]', label: 'Oldest unresolved tickets' },
      { id: 'sla-status', selector: 'h2:text-is("SLA Status") >> xpath=ancestor::div[3]', label: 'SLA breaches' },
    ],
  },
  {
    id: 'tickets-list',
    route: '/tickets',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Tickets")', 'table tbody tr'],
    alt: 'The unified ticket inbox: filters for status, priority and category above a table of tickets from Discord, Slack, email and Circle.',
    pins: [
      { id: 'filters', selector: 'form:has(select)', label: 'Filters and CSV export' },
      { id: 'source', selector: 'table thead th:text-is("Source")', label: 'Channel the ticket came from' },
      { id: 'priority', selector: 'table thead th:text-is("Priority")', label: 'Priority' },
      { id: 'ai-status', selector: 'table thead th:text-is("AI")', label: 'What the AI did with it' },
      { id: 'ticket-row', selector: 'table tbody tr:first-child', label: 'One ticket, click to open' },
    ],
  },
  {
    id: 'ticket-detail',
    route: '/tickets/75',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Calibrate servo range")', 'text=Auto-answered 96%'],
    alt: 'An auto-answered ticket: the original message, the AI answer marked as approved, a green confidence panel showing 96 percent, and thumbs up and down buttons to rate the answer.',
    pins: [
      { id: 'original-message', selector: 'text=ORIGINAL MESSAGE >> xpath=ancestor::div[1]', label: 'What the customer asked' },
      { id: 'ai-draft', selector: 'text=AI Draft Answer >> xpath=ancestor::div[3]', label: 'The AI draft answer' },
      { id: 'confidence', selector: 'text=AI CONFIDENCE >> xpath=ancestor::div[2]', label: 'Confidence and reasoning' },
      { id: 'feedback', selector: 'text=Was this answer good? >> xpath=ancestor::div[1]', label: 'Rate the answer' },
      { id: 'details', selector: 'text=DETAILS >> xpath=ancestor::div[1]', label: 'Severity and SLA deadlines' },
    ],
  },
  {
    id: 'ticket-detail-review',
    route: '/tickets/73',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Scout-L2 wiring diagram")', 'text=AI needs review'],
    alt: 'A ticket that needs a person: a low-confidence 45 percent AI draft, an amber confidence panel, and a related earlier question.',
    pins: [
      { id: 'status-badges', selector: 'text=AI needs review', label: 'Flagged for human review' },
      { id: 'ai-draft', selector: 'text=AI Draft Answer >> xpath=ancestor::div[3]', label: 'Draft to approve or edit' },
      { id: 'confidence', selector: 'text=AI CONFIDENCE >> xpath=ancestor::div[2]', label: 'Why confidence is low' },
      { id: 'related', selector: 'text=RELATED QUESTIONS >> xpath=ancestor::div[1]', label: 'Similar earlier questions' },
      { id: 'update-status', selector: 'text=UPDATE STATUS >> xpath=ancestor::div[1]', label: 'Update status' },
    ],
  },
  {
    id: 'knowledge-base',
    route: '/kb',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Knowledge Base")', 'text=Write an answer by hand'],
    alt: 'The knowledge base page from the top: the title, the Manage, Knowledge coverage and Review tabs, a form for writing an answer by hand, and the connected GitHub repository below it.',
    pins: [
      { id: 'tabs', selector: 'button:text-is("Manage") >> xpath=ancestor::div[1]', label: 'Manage, coverage and review tabs' },
      { id: 'write-answer', selector: 'text=Write an answer by hand >> xpath=ancestor::div[1]', label: 'Write an answer by hand' },
      { id: 'add-article', selector: 'button:text-is("Add to knowledge base")', label: 'Add it to the knowledge base' },
      { id: 'github-repos', selector: 'text=GitHub Repositories >> xpath=ancestor::div[1]', label: 'Sync a GitHub repository' },
    ],
  },
  {
    id: 'knowledge-base-articles',
    route: '/kb',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Knowledge Base")', 'form:has(button:text-is("Search"))'],
    actions: [{ scrollTo: 'form:has(button:text-is("Search"))' }],
    alt: 'The knowledge base article list: a search box, then each article with its title and content.',
    pins: [
      { id: 'search', selector: 'form:has(button:text-is("Search"))', label: 'Search the knowledge base' },
      { id: 'article-count', selector: 'text=/\\d+ articles?/', label: 'How many articles' },
      { id: 'article', selector: 'ul.space-y-2 > li:has(h2):first-child', label: 'One article' },
      { id: 'source-ticket', selector: 'a:has-text("From ticket") >> nth=0', label: 'The ticket an article came from' },
    ],
  },
  {
    id: 'knowledge-gaps',
    route: '/knowledge-gaps',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Knowledge Gaps")', 'text=Distinct questions'],
    alt: 'The knowledge gaps queue: counts of open gap tickets, the most-asked unanswered questions, and a category breakdown.',
    pins: [
      { id: 'summary', selector: 'text=Open gap tickets >> xpath=ancestor::div[2]', label: 'Gap counts' },
      { id: 'questions', selector: 'h2:text-is("Distinct questions") >> xpath=ancestor::div[2]', label: 'Most-asked unanswered questions' },
      { id: 'add-to-kb', selector: 'a:has-text("+ KB") >> nth=0', label: 'Turn a gap into an article' },
      { id: 'categories', selector: 'h2:text-is("Gaps by category") >> xpath=ancestor::div[2]', label: 'Gaps by category' },
    ],
  },
  {
    id: 'analytics',
    route: '/analytics',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Analytics")', 'text=Deflection trend'],
    alt: 'The analytics page: staff time saved, deflection rate and questions handled, above a day-by-day deflection trend.',
    pins: [
      { id: 'time-saved', selector: 'text=STAFF TIME SAVED >> xpath=ancestor::div[1]', label: 'Staff time saved' },
      { id: 'deflection-rate', selector: 'text=DEFLECTION RATE >> xpath=ancestor::div[1]', label: 'Deflection rate' },
      { id: 'questions-handled', selector: 'text=QUESTIONS HANDLED >> xpath=ancestor::div[1]', label: 'Questions handled' },
      { id: 'trend', selector: 'section:has(h2:has-text("Deflection trend"))', label: 'Daily deflection trend' },
    ],
  },
  {
    id: 'integrations',
    route: '/integrations',
    // Cropped above the legacy manual-setup block, which lists a masked token.
    viewport: { width: 1440, height: 740 },
    waitFor: ['h1:has-text("Integrations")', 'text=Add answerLoops to Discord'],
    alt: 'The integrations page: a tab for each channel and service, with the Discord tab open showing a connected server.',
    pins: [
      { id: 'channel-tabs', selector: '.dashboard-tabs', label: 'One tab per channel' },
      { id: 'connection-status', selector: 'span:text-is("Active")', label: 'Connection status' },
      { id: 'add-server', selector: 'text=Add answerLoops to Discord', label: 'Connect with one click' },
      { id: 'connected-server', selector: 'text=Northwind Robotics Community >> xpath=ancestor::div[2]', label: 'A connected server' },
    ],
  },
  {
    id: 'ai-model',
    route: '/settings?tab=ai',
    viewport: { width: 1440, height: 760 },
    waitFor: ['h1:has-text("Settings")', 'text=Chat provider'],
    alt: 'Settings, AI Model tab: the chat provider, model, API key status and embedding model for the workspace.',
    pins: [
      { id: 'settings-tabs', selector: 'button:text-is("General") >> xpath=ancestor::div[1]', label: 'Settings tabs' },
      { id: 'edit', selector: 'button:text-is("Edit")', label: 'Change the model' },
      { id: 'chat-provider', selector: 'text=Chat provider >> xpath=ancestor::div[2]', label: 'Provider, model and key status' },
      { id: 'embeddings', selector: 'text=Embedding provider >> xpath=ancestor::div[1]', label: 'Embeddings' },
    ],
  },
  {
    id: 'billing',
    route: '/billing',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Billing")', 'text=Usage this month'],
    alt: 'The billing page: monthly usage against the plan limit, and the Standard, Pro and Enterprise plans with Pro marked as current.',
    pins: [
      { id: 'usage', selector: 'text=Usage this month >> xpath=ancestor::div[2]', label: 'Usage this month' },
      { id: 'standard', selector: 'span:text-is("Standard") >> xpath=ancestor::div[4]', label: 'Standard plan' },
      { id: 'current-plan', selector: 'span:text-is("Pro") >> xpath=ancestor::div[4]', label: 'Your current plan' },
      { id: 'enterprise', selector: 'span:text-is("Enterprise") >> xpath=ancestor::div[4]', label: 'Enterprise plan' },
    ],
  },
  {
    id: 'team',
    route: '/settings?tab=team',
    viewport: { width: 1440, height: 940 },
    waitFor: ['h1:has-text("Settings")', 'text=Pending Invites'],
    alt: 'Settings, Team tab: workspace members with their roles, pending invitations, and a form to invite a teammate.',
    pins: [
      { id: 'members', selector: 'text=Members >> xpath=ancestor::div[2]', label: 'Members and roles' },
      { id: 'transfer', selector: 'button:text-is("Transfer Ownership") >> nth=0', label: 'Transfer ownership' },
      { id: 'remove', selector: 'button:text-is("Remove") >> nth=0', label: 'Remove a member' },
      { id: 'pending-invites', selector: 'text=Pending Invites >> xpath=ancestor::div[2]', label: 'Pending invitations' },
    ],
  },
  {
    id: 'faq-generator',
    route: '/faq',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("FAQ")', 'button:has-text("Regenerate FAQ")'],
    alt: 'The FAQ generator: a frequently asked questions document built from recent tickets, with a Regenerate FAQ button.',
    pins: [
      { id: 'generated-from', selector: 'text=/Generated .* tickets/', label: 'When it was generated and from how many tickets' },
      { id: 'regenerate', selector: 'button:has-text("Regenerate FAQ")', label: 'Regenerate from recent tickets' },
      { id: 'faq-body', selector: 'text=Frequently asked this week >> xpath=ancestor::div[1]', label: 'The generated FAQ' },
    ],
  },
  {
    id: 'simulation',
    route: '/simulation',
    viewport: { width: 1440, height: 520 },
    waitFor: ['h1:has-text("Simulation Mode")', 'button:has-text("Run simulation")'],
    // Captured before a run: the in-process stand-in for the model returns the
    // same confidence and zero latency for every ticket, so results would mislead.
    alt: 'Simulation mode: the replay controls for choosing how many past tickets to test, which model to use and the deflect threshold, with a Run simulation button.',
    pins: [
      { id: 'tickets-to-replay', selector: 'input[type="number"]', label: 'How many tickets to replay' },
      { id: 'model', selector: 'select', label: 'Which model to test' },
      { id: 'threshold', selector: 'input[type="range"]', label: 'Deflect threshold' },
      { id: 'run', selector: 'button:has-text("Run simulation")', label: 'Run the simulation' },
    ],
  },
  {
    id: 'feedback-board',
    route: '/dashboard',
    viewport: { width: 1440, height: 900 },
    waitFor: ['h1:has-text("Good to see you")'],
    keepFeedbackWidget: true,
    actions: [
      { click: 'button.fixed:has-text("Feedback")' },
      { waitFor: 'section[role="dialog"]:has-text("Product Feedback")' },
      { waitFor: 'text=Would love a weekly digest' },
    ],
    capture: { type: 'element', selector: 'section[role="dialog"]:has-text("Product Feedback")' },
    // The seeded maintainer reply carries a personal name; show the team instead.
    textMask: [{ pattern: 'Nathan @ answerLoops', replacement: 'answerLoops team' }],
    alt: 'The product feedback board: a Feedback tab listing submitted ideas with a team reply, an Updates tab, and a box to leave feedback.',
    pins: [
      { id: 'tabs', selector: 'section[role="dialog"] button:has-text("Updates")', label: 'Feedback and Updates tabs' },
      { id: 'feedback-item', selector: 'text=Would love a weekly digest >> xpath=ancestor::li[1]', label: 'A submitted idea' },
      { id: 'team-reply', selector: 'text=Planned', label: 'Status set by the team' },
      { id: 'compose', selector: 'section[role="dialog"] textarea', label: 'Leave your own feedback' },
    ],
  },
]
