/**
 * Shared request-building for app/api/widget/chat/route.ts tests.
 *
 * The route is a CopilotKit single-route runtime endpoint (`useSingleEndpoint`
 * on the client provider): every request is `{ method: "agent/run", body }`
 * where `body` is an AG-UI RunAgentInput — widgetToken/visitorId ride in
 * `forwardedProps`, not the envelope's top level, and messages are AG-UI's
 * `{ id, role, content }` rather than the AI SDK's `{ role, parts }`.
 */

let msgSeq = 0
export const userMsg = (content: string) => ({ id: `m${msgSeq++}`, role: 'user', content })
export const assistantMsg = (content: string) => ({ id: `a${msgSeq++}`, role: 'assistant', content })

export function widgetChatRequest({
  widgetToken,
  visitorId,
  messages,
}: {
  widgetToken?: unknown
  visitorId?: unknown
  messages?: unknown
}): Request {
  const envelope = {
    method: 'agent/run',
    params: { agentId: 'default' },
    body: {
      threadId: 'thread-1',
      runId: 'run-1',
      tools: [],
      context: [],
      messages,
      forwardedProps: { widgetToken, visitorId },
    },
  }
  return new Request('https://app.test/api/widget/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  })
}

/**
 * The AG-UI response streams lazily — the agent factory (and so the mocked
 * Mastra `Agent.stream()`) only runs once something actually reads the body,
 * same as a real client consuming it. Node's `Response.text()` enforces a
 * byte-stream body contract this runtime's string-chunk stream doesn't meet,
 * so drain with a raw reader instead.
 */
export async function drain(res: Response): Promise<void> {
  const reader = res.body!.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
}
