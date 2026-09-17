# @answerloops/agent-sdk

Typed Node/browser client for the [answerLoops Agent API](https://answerloops.com/docs/integrations/agent-api) — search the knowledge base, read the FAQ digest, list/create tickets, and generate grounded answers. Also ships a CLI (`answerloops`) that bootstraps a self-hosted instance or installs the [Claude Code agent skills](https://answerloops.com/docs/integrations/agent-skills).

## Getting started

Don't have a running answerLoops instance yet? Bootstrap one:

```bash
npx @answerloops/agent-sdk setup
```

Clones the repo if needed, checks Docker + git are present, generates
`AUTH_SECRET`/`ENCRYPTION_KEY`, starts the published image via Docker
Compose, and polls `/api/health` until it's actually up. It never invents a
real credential — if `DATABASE_URL`, `AUTH_URL`, or the Google OAuth pair are
missing, it tells you exactly what to add to `.env` and exits, rather than
guessing.

Already have a workspace (hosted or self-hosted) and just want an agent
connected to it? Install the Claude Code skills instead:

```bash
npx @answerloops/agent-sdk skills answerloops-setup answerloops-operate
```

Writes both into `.claude/skills/` — install just one by naming it alone.

Building against the API directly instead? Install the library:

```bash
npm install @answerloops/agent-sdk
```

## Usage

```ts
import { AgentClient } from "@answerloops/agent-sdk";

const client = new AgentClient({
  apiKey: process.env.ANSWERLOOPS_API_KEY!, // al_live_...
  // baseUrl: "https://your-self-hosted-instance.example.com", // defaults to https://answerloops.com
});

const { results } = await client.searchKb({ query: "how do I reset my api key" });

const answer = await client.generateAnswer({ question: "How do I reset my API key?" });

const ticket = await client.createTicket({ content: "My webhook stopped firing." });

const { tickets, next_cursor } = await client.getTickets({ status: "open", limit: 10 });
// next_cursor is non-null while more tickets remain — pass it back as `cursor` to keep paging:
// await client.getTickets({ status: "open", limit: 10, cursor: next_cursor });
```

Every key carries least-privilege scopes (`kb:read`, `faq:read`, `tickets:read`, `tickets:write`, `answers:write`) set in **Settings → API Keys**. A call against a scope the key doesn't have throws `AgentApiError` with `status === 403`.

## Errors

Non-2xx responses throw `AgentApiError`:

```ts
import { AgentApiError } from "@answerloops/agent-sdk";

try {
  await client.generateAnswer({ question: "..." });
} catch (err) {
  if (err instanceof AgentApiError) {
    console.error(err.status, err.body);
  }
}
```

## License

[AGPL-3.0](./LICENSE)
