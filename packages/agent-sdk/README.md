# @answerloops/agent-sdk

Typed Node/browser client for the [answerLoops Agent API](https://answerloops.com/docs/integrations/agent-api) — search the knowledge base, read the FAQ digest, list/create tickets, and generate grounded answers.

## Install

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

const { tickets } = await client.getTickets({ status: "open", limit: 10 });
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
