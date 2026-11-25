import { describe, expect, it } from 'vitest'
import { AgentApiError, AgentClient } from '@/packages/agent-sdk/src/index'

function createClient(response: Response) {
  return new AgentClient({
    apiKey: 'al_test_key',
    baseUrl: 'https://example.test',
    fetch: async () => response,
  })
}

describe('AgentClient HTTP error handling', () => {
  it('returns AgentApiError when the server responds with a non-JSON error body', async () => {
    const client = createClient(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    )

    const error = await client.getFaq().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AgentApiError)

    if (!(error instanceof AgentApiError)) return

    expect(error.status).toBe(502)
    expect(error.body).toBeUndefined()
    expect(error.code).toBeUndefined()
    expect(error.message).toBe('Agent API request failed: 502')
  })

  it('preserves structured JSON error details and error codes', async () => {
    const body = {
      error: {
        message: 'Rate limit exceeded',
        code: 'rate_limited',
      },
    }

    const client = createClient(
      new Response(JSON.stringify(body), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const error = await client.getFaq().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AgentApiError)

    if (!(error instanceof AgentApiError)) return

    expect(error.status).toBe(429)
    expect(error.body).toEqual(body)
    expect(error.code).toBe('rate_limited')
    expect(error.message).toBe('Rate limit exceeded')
  })

  it('returns AgentApiError for an empty HTTP error response', async () => {
    const client = createClient(new Response(null, { status: 401 }))

    const error = await client.getFaq().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AgentApiError)

    if (!(error instanceof AgentApiError)) return

    expect(error.status).toBe(401)
    expect(error.body).toBeUndefined()
    expect(error.message).toBe('Agent API request failed: 401')
  })

  it('continues to parse successful JSON responses', async () => {
    const body = { faqs: [] }
    const client = createClient(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(client.getFaq()).resolves.toEqual(body)
  })

  it('continues to reject malformed JSON in successful responses', async () => {
    const client = createClient(
      new Response('<html>Unexpected response</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    )

    await expect(client.getFaq()).rejects.toThrow(SyntaxError)
  })
})
