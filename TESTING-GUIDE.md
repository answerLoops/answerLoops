# Owner Verification Guide

> Work through this top to bottom on every new deployment or after shipping features.
> Check each box as you confirm it works. Keep this file open alongside the app.
>
> **Legend:** 🔧 requires config first · 📋 requires prior step · ✅ mark when verified

---

## 0. Pre-flight — environment

Before anything else, confirm these are set in your `.env` (or production environment):

```
DATABASE_URL=               # Neon connection string
AUTH_SECRET=                # random 32+ char string
ENCRYPTION_KEY=             # 64-char hex string
```

At least one OAuth provider:
```
AUTH_GITHUB_ID / AUTH_GITHUB_SECRET
AUTH_DISCORD_ID / AUTH_DISCORD_SECRET
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
```

Optional but needed for full validation:
```
RESEND_API_KEY=             # email alerts
STRIPE_SECRET_KEY=          # billing
STRIPE_WEBHOOK_SECRET=      # billing webhook
OPENAI_API_KEY=             # or configure per-org in Settings → AI Model
```

- [ ] `pnpm build` runs clean
- [ ] `pnpm test --run` — all 53 tests pass
- [ ] App starts (`pnpm dev` or Docker)
- [ ] `http://localhost:3000` loads the landing page

---

## 1. Auth & onboarding

- [ ] Click **Sign in** on landing page → OAuth provider login works
- [ ] After first login → redirected to `/onboarding`
- [ ] Complete onboarding wizard → redirected to `/dashboard`
- [ ] Sign out from topbar → redirected to login
- [ ] Sign back in → goes directly to `/dashboard` (no re-onboarding)

---

## 2. Dashboard

- [ ] `/dashboard` loads without error
- [ ] Greeting shows your name: `"Good morning, [name]"`
- [ ] Stat cards render (all 8: Auto-answered, Deflection Rate, Open, In Progress, Resolved, Needs Review, AI Drafts, SLA Breaches)
- [ ] With no tickets: empty state message visible
- [ ] "View all tickets" link → goes to `/tickets`

---

## 3. Settings — AI model

> Must be configured before any AI features will work.

- [ ] Go to **Settings → AI Model**
- [ ] Select provider (OpenAI recommended for initial test)
- [ ] Enter API key + model ID (e.g. `gpt-4o`)
- [ ] Click Save — no error shown
- [ ] Masked key indicator appears confirming key is stored

---

## 4. Settings — Discord integration 🔧

> Requires a Discord bot token. Skip if not testing Discord.

- [ ] Go to **Settings → Integrations → Discord**
- [ ] Enter bot token (format: `xxx.xxx.xxx`)
- [ ] Enter one or more channel IDs (comma-separated)
- [ ] Click Connect — bot secret revealed
- [ ] Copy the bot secret — you'll need it for the bot process
- [ ] Start the bot (`pnpm bot:dev`) with `BOT_SECRET=<secret>`
- [ ] In Discord, post a message in a configured channel
- [ ] Return to `/tickets` — new ticket appears within ~5 seconds
- [ ] Ticket has: content, category, severity, AI summary populated

**Escalation routing (T2-2):**
- [ ] Enter a Discord **Role ID** in the Escalation Role ID field
- [ ] Set confidence threshold (e.g. `0.5` to force escalation for testing)
- [ ] Post a question in Discord that the AI can't confidently answer
- [ ] Verify bot reply includes `@role` mention and `[Needs Human Review — X%]` prefix
- [ ] Reset threshold back to `0.8` after testing

---

## 5. Settings — Slack integration 🔧

> Requires a Slack app with Events API. Skip if not testing Slack.

- [ ] Go to **Settings → Integrations → Slack**
- [ ] Enter bot token (`xoxb-...`), signing secret, team ID (`T...`), channel IDs
- [ ] Click Connect — no error
- [ ] In Slack app config, set Events API URL to `https://your-domain/api/slack/events`
- [ ] Subscribe to `message.channels` and `reaction_added` events
- [ ] Post a message in a configured Slack channel
- [ ] Return to `/tickets` — new ticket appears

**Escalation routing (T2-2):**
- [ ] Enter Slack user group ID (`S...`) or user ID (`U...`) in Escalation User Group ID field
- [ ] Post a low-confidence question → bot reply includes `<!subteam^S...>` or `<@U...>` mention

---

## 6. AI pipeline — triage + auto-deflect

> Requires at least one ticket in the system (from Discord, Slack, or manual create).

- [ ] Open any ticket in `/tickets`
- [ ] Confirm fields: category, severity/priority, AI summary are populated
- [ ] AI Draft section shows generated answer
- [ ] Confidence badge visible (e.g. `72% confidence`)
- [ ] High confidence ticket (>80%): `ai_draft_status = posted`, answer sent to channel
- [ ] Low confidence ticket (<80%): `ai_draft_status = needs_human`, routed to human queue

---

## 7. Knowledge Base

- [ ] Go to `/kb`
- [ ] Click **New Article** → fill title + answer → Save
- [ ] Article appears in list
- [ ] Search bar: type part of the title → article surfaces in results
- [ ] Open a resolved ticket → click **Promote to KB** → article created from ticket
- [ ] Promoted article appears in `/kb` list

---

## 8. Widget — lead capture + chat (T1-2, T1-3, T1-5)

> Requires widget token. Find it in **Settings → Website Widget**.

- [ ] Go to **Settings → Website Widget** → copy embed snippet or widget token
- [ ] Open `http://localhost:3000/widget/[your-widget-token]` directly
- [ ] **Lead capture gate:** email input shown before chat (Hobby plan)
- [ ] Enter an email → click Continue → chat UI opens
- [ ] Go to `/leads` dashboard → email appears in list
- [ ] Send a message in widget → AI responds
- [ ] Response cites a KB article: `📚 Source: [article title]` visible at bottom (T1-3)
- [ ] **White-label test:** upgrade org to Pro in Stripe → reload widget → "Powered by answerLoops" footer gone (T1-2)
- [ ] **Multi-language test:** send a message in Spanish → AI replies in Spanish (T1-1)

---

## 9. CSV Export (T1-4)

- [ ] Go to `/tickets` → click **Export CSV** button → file downloads
- [ ] Open CSV: columns present: `id, status, priority, category, ai_summary, content, discord_author_name, created_at, resolved_at`
- [ ] Go to `/leads` → click **Export CSV** → file downloads
- [ ] Open CSV: columns present: `id, org_id, widget_token, email, created_at`

---

## 10. Knowledge Gap Dashboard (T2-1)

- [ ] Go to `/knowledge-gaps` (sidebar: alert circle icon)
- [ ] 4 stat cards render: Total gaps, Needs human, Low confidence, Missing KB article
- [ ] Gap ticket list shows tickets with reason badges (`Low AI confidence` / `Needs human` / `Missing KB article`)
- [ ] Click `+ KB` on any gap row → navigates to `/kb?sourceTicket=[id]`
- [ ] Category bar chart on right shows gap counts per category
- [ ] If no gaps: green empty state "AI is answering everything confidently"

---

## 11. CSAT scoring (T2-3)

> Requires an auto-deflected answer to have been posted to Discord or Slack.

- [ ] After an auto-deflected answer posts, a follow-up message appears:
  `"How would you rate this answer? 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣"`
- [ ] React with `1️⃣` through `5️⃣` on that message
- [ ] Go to **Analytics** → scroll to **Customer satisfaction (CSAT)** section
- [ ] Avg rating displays (e.g. `4.0/5 ★★★★`)
- [ ] Per-star breakdown bar chart shows your reaction

**Discord bot test:**
- [ ] POST to `/api/ingest/reaction` with `{ message_id, emoji: "3️⃣", user_id }` and `Authorization: Bearer <bot-secret>`
- [ ] CSAT rating stored → appears on Analytics

---

## 12. Analytics

- [ ] Go to `/analytics`
- [ ] Hero cards: Deflection Rate %, Staff-Hours Saved, Total Answered all populate
- [ ] 14-day trend chart shows bars (may be empty if <1 day of data)
- [ ] Category breakdown shows topics
- [ ] SLA section: Response SLA %, Avg time to first response, SLA breaches
- [ ] CSAT section: shows avg rating or "No ratings yet" message
- [ ] Answer quality by category table shows 👍/👎 counts

---

## 13. FAQ

- [ ] Go to `/faq`
- [ ] Click **Generate FAQ** (requires resolved tickets)
- [ ] FAQ snapshot generated and displayed
- [ ] Questions + answers formatted correctly

---

## 14. Team management

- [ ] Go to **Settings → Team**
- [ ] Click **Invite member** → enter an email → invite sent
- [ ] Go to `/invite/[token]` (check email or DB for token)
- [ ] Accept invite → user added to org
- [ ] Back in Settings → Team → invited user appears in member list

---

## 15. Billing (Stripe) 🔧

> Requires `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` set.

- [ ] Go to `/billing`
- [ ] Current plan displayed
- [ ] Trial countdown banner visible if in trial period
- [ ] Click **Upgrade** → Stripe checkout opens
- [ ] Use Stripe test card `4242 4242 4242 4242` → complete checkout
- [ ] Return to app → plan updated to Pro/Scale/Enterprise
- [ ] Widget white-label: "Powered by answerLoops" footer gone on widget page
- [ ] Click **Manage billing** → Stripe customer portal opens

---

## 16. Email alerts (Resend) 🔧

> Requires `RESEND_API_KEY` set.

- [ ] Create a critical/high priority ticket → email alert received
- [ ] Resolve a ticket → resolution email received
- [ ] Trigger an SLA breach (set tight SLA in Settings → SLA Config) → breach email received

---

## 17. GitHub source integration 🔧

> Requires GitHub App installed on at least one repo.

- [ ] Go to **Settings → GitHub Repos** → add a repo
- [ ] Submit a ticket that asks about code in that repo
- [ ] AI agent answer references specific files from the repo
- [ ] Ticket detail shows answer with code citations

---

## 18. Production Docker

- [ ] `docker compose -f docker-compose.prod.yml up --build`
- [ ] App accessible at configured port
- [ ] Migrations ran on startup (check logs for `migrations applied`)
- [ ] Sign in works
- [ ] No errors in `docker logs`

---

## Feature checklist summary

| Area | Feature | Verified |
|------|---------|---------|
| Core | Auth + onboarding | ☐ |
| Core | Dashboard + stats | ☐ |
| Core | Ticket ingestion (Discord) | ☐ |
| Core | Ticket ingestion (Slack) | ☐ |
| Core | AI triage + auto-deflect | ☐ |
| Core | Knowledge Base CRUD + search | ☐ |
| Core | Analytics dashboard | ☐ |
| Core | FAQ generation | ☐ |
| Core | Team invites | ☐ |
| Core | Billing + trial | ☐ |
| Core | Email alerts | ☐ |
| T1-1 | Multi-language AI responses | ☐ |
| T1-2 | White-label widget (Pro+) | ☐ |
| T1-3 | Source citations on widget answers | ☐ |
| T1-4 | CSV export (tickets + leads) | ☐ |
| T1-5 | Lead capture in widget | ☐ |
| T2-1 | Knowledge gap dashboard | ☐ |
| T2-2 | Human escalation routing (Discord) | ☐ |
| T2-2 | Human escalation routing (Slack) | ☐ |
| T2-3 | CSAT prompt posts after auto-deflect | ☐ |
| T2-3 | CSAT reaction captured + shown in Analytics | ☐ |
| T2-4 | Discord slash commands `/ask` `/summarize` | ☐ |

---

## Maintenance notes

- Add a new row to the **Feature checklist summary** table when shipping any new feature.
- Add a new numbered section above when a feature needs its own multi-step verification.
- Mark items `✅ [date]` in the summary when a full production validation run completes.
- Re-run from section 0 after any deployment or env var change.
