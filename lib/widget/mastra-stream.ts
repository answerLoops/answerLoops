// Mastra's Agent.stream().fullStream wraps every chunk in its own envelope —
// `{ type: 'text-delta', payload: { text, id }, runId, from: 'AGENT' }` — not
// the flat AI SDK v5-style shape (`{ type: 'text-delta', text }`) that
// CopilotKit's BuiltInAgent 'aisdk' factory reads (see
// @copilotkit/runtime's agent/converters/aisdk.mjs, which does
// `"text" in p ? p.text : ""` — `text` never exists at the top level of a
// Mastra chunk, only nested under `.payload`). Without this, every delta the
// factory emits is silently `""`: the run completes cleanly with the right
// event count, just with no visible content — indistinguishable from a
// misconfigured provider until you inspect the raw stream. Spreading
// `payload` onto the chunk gives the converter the flat shape it expects.
export async function* flattenMastraStream(
  stream: AsyncIterable<unknown>,
  onFirstText?: () => void
): AsyncIterable<unknown> {
  let sawText = false
  for await (const chunk of stream) {
    if (chunk && typeof chunk === 'object' && 'payload' in chunk) {
      const c = chunk as { type?: string; payload?: unknown }
      const payload = c.payload
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>
        switch (c.type) {
          // Tool chunks use Mastra's own field names; the converter wants the
          // AI SDK's. `tool-call-input-streaming-start` / `tool-call-delta`
          // become `tool-input-start` / `tool-input-delta` so the converter
          // can emit args as they stream instead of only at the end.
          case 'tool-call-input-streaming-start':
            yield { type: 'tool-input-start', id: p.toolCallId, toolName: p.toolName }
            continue
          case 'tool-call-delta':
            yield { type: 'tool-input-delta', id: p.toolCallId, delta: p.argsTextDelta }
            continue
          case 'tool-call-input-streaming-end':
            yield { type: 'tool-input-end', id: p.toolCallId }
            continue
          case 'tool-call':
            yield { type: 'tool-call', toolCallId: p.toolCallId, toolName: p.toolName, input: p.args }
            continue
          case 'tool-result':
            // An erroring tool must not surface its raw error text to the
            // visitor; the renderer draws nothing for anything that isn't a
            // well-formed `{ ok: true }` result.
            yield {
              type: 'tool-result',
              toolCallId: p.toolCallId,
              toolName: p.toolName,
              output: p.isError ? { ok: false } : p.result,
            }
            continue
          case 'text-delta':
            if (!sawText) {
              sawText = true
              onFirstText?.()
            }
            break
        }
        yield { ...chunk, ...payload }
        continue
      }
    }
    yield chunk
  }
}
