import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listOpenAIModels,
  listAnthropicModels,
  listGoogleModels,
  listGroqModels,
  listMistralModels,
  listXaiModels,
  listModelsForProvider,
  XAI_BASE_URL,
} from '@/lib/ai/list-models'

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('fetch', h.fetchMock)

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listOpenAIModels', () => {
  it('calls /v1/models with a bearer token and keeps only chat-shaped model IDs', async () => {
    h.fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-6-astra' },
          { id: 'gpt-6-luna' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'dall-e-3' },
          { id: 'tts-1' },
          { id: 'omni-moderation-latest' },
        ],
      })
    )

    const models = await listOpenAIModels('sk-test')

    expect(h.fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } })
    )
    expect(models).toEqual(['gpt-6-astra', 'gpt-6-luna'])
  })

  it('respects a custom base URL, stripping a trailing slash', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-6-luna' }] }))
    await listOpenAIModels('sk-test', 'https://my-proxy.example.com/v1/')
    expect(h.fetchMock).toHaveBeenCalledWith(
      'https://my-proxy.example.com/v1/models',
      expect.anything()
    )
  })

  it('throws with the status and body on a non-2xx response', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'invalid api key' } }, false, 401))
    await expect(listOpenAIModels('bad-key')).rejects.toThrow(/401/)
  })
})

describe('listAnthropicModels', () => {
  it('calls /v1/models with x-api-key and the anthropic-version header', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-sonnet-4-6' }] }))
    const models = await listAnthropicModels('sk-ant-test')
    expect(h.fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: { 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' },
      })
    )
    expect(models).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6'])
  })
})

describe('listGoogleModels', () => {
  it('passes the key as a query param and keeps only generateContent-capable models', async () => {
    h.fetchMock.mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      })
    )
    const models = await listGoogleModels('goog-key')
    expect(h.fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=goog-key',
      expect.anything()
    )
    expect(models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })
})

describe('listGroqModels', () => {
  it('calls the OpenAI-compatible Groq endpoint with a bearer token', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] }))
    const models = await listGroqModels('gsk-test')
    expect(h.fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer gsk-test' } })
    )
    expect(models).toEqual(['llama-3.3-70b-versatile'])
  })
})

describe('listMistralModels', () => {
  it('calls Mistral\'s /v1/models with a bearer token', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'mistral-large-latest' }] }))
    const models = await listMistralModels('mis-test')
    expect(h.fetchMock).toHaveBeenCalledWith(
      'https://api.mistral.ai/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer mis-test' } })
    )
    expect(models).toEqual(['mistral-large-latest'])
  })
})

describe('listXaiModels', () => {
  it('calls xAI\'s OpenAI-compatible /v1/models with a bearer token', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'grok-4' }, { id: 'grok-4-fast' }] }))
    const models = await listXaiModels('xai-test')
    expect(h.fetchMock).toHaveBeenCalledWith(`${XAI_BASE_URL}/models`, expect.objectContaining({
      headers: { Authorization: 'Bearer xai-test' },
    }))
    expect(models).toEqual(['grok-4', 'grok-4-fast'])
  })
})

describe('listModelsForProvider', () => {
  it('dispatches to the matching provider function', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'mistral-small-latest' }] }))
    const models = await listModelsForProvider('mistral', 'mis-test', null)
    expect(models).toEqual(['mistral-small-latest'])
    expect(h.fetchMock).toHaveBeenCalledWith('https://api.mistral.ai/v1/models', expect.anything())
  })

  it('falls back to the OpenAI list for an unrecognized provider value', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-6-luna' }] }))
    const models = await listModelsForProvider('some-unknown-provider', 'sk-test', null)
    expect(models).toEqual(['gpt-6-luna'])
    expect(h.fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.anything())
  })

  it('routes openai-compatible through listOpenAIModels with the given base URL', async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'llama3.2' }] }))
    const models = await listModelsForProvider('openai-compatible', '', 'http://localhost:11434/v1')
    expect(models).toEqual(['llama3.2'])
    expect(h.fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/models', expect.anything())
  })
})
