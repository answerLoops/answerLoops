import { describe, it, expect } from 'vitest'
import { validateAIConfig, type AIConfigInput } from '@/lib/ai/config-validation'
import type { OrgAIConfig } from '@/lib/db/queries/ai-config'

// validateAIConfig rejects configs that parse but can't run. Covers the three
// audit findings: no test-connection safety net for the wrong-key case (16),
// non-OpenAI chat + OpenAI embeddings with no embedding key (17), and a
// provider switched with the key field left blank.

function cfg(over: Partial<AIConfigInput> = {}): AIConfigInput {
  return {
    chat_provider: 'openai',
    chat_model: 'gpt-4o',
    chat_api_key: 'sk-new',
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-3-small',
    ...over,
  }
}

function existing(over: Partial<OrgAIConfig> = {}): OrgAIConfig {
  return {
    id: 1,
    org_id: 7,
    chat_provider: 'openai',
    chat_model: 'gpt-4o',
    chat_api_key: 'sk-old',
    chat_base_url: null,
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-3-small',
    embedding_api_key: null,
    embedding_base_url: null,
    ...over,
  }
}

describe('validateAIConfig', () => {
  it('passes a fresh OpenAI config with a key', () => {
    expect(validateAIConfig(cfg(), null)).toBeNull()
  })

  it('rejects a named provider with no key (new or stored)', () => {
    expect(validateAIConfig(cfg({ chat_provider: 'anthropic', chat_api_key: undefined }), null))
      .toMatch(/Add an API key for Anthropic/)
  })

  it('allows an update that keeps the stored key (blank field, same provider)', () => {
    expect(validateAIConfig(cfg({ chat_api_key: undefined }), existing())).toBeNull()
  })

  it('rejects a chat-provider switch with the key field left blank', () => {
    const err = validateAIConfig(cfg({ chat_provider: 'anthropic', chat_api_key: undefined }), existing())
    expect(err).toMatch(/changed the chat provider to Anthropic/)
    expect(err).toMatch(/saved key was for OpenAI/)
  })

  it('accepts a chat-provider switch when a new key is supplied', () => {
    // anthropic chat + openai embeddings still needs its own embedding key
    expect(
      validateAIConfig(
        cfg({ chat_provider: 'anthropic', chat_api_key: 'sk-ant-new', embedding_api_key: 'sk-oai' }),
        existing(),
      ),
    ).toBeNull()
  })

  it('rejects non-OpenAI chat + OpenAI embeddings with no embedding key (finding 17)', () => {
    const err = validateAIConfig(
      cfg({ chat_provider: 'anthropic', chat_api_key: 'sk-ant', embedding_provider: 'openai', embedding_api_key: undefined }),
      null,
    )
    expect(err).toMatch(/OpenAI embeddings need their own API key/)
  })

  it('accepts non-OpenAI chat + OpenAI embeddings when an embedding key is given', () => {
    expect(
      validateAIConfig(
        cfg({ chat_provider: 'anthropic', chat_api_key: 'sk-ant', embedding_provider: 'openai', embedding_api_key: 'sk-oai' }),
        null,
      ),
    ).toBeNull()
  })

  it('lets OpenAI chat + OpenAI embeddings share one key', () => {
    expect(validateAIConfig(cfg({ embedding_api_key: undefined }), null)).toBeNull()
  })

  it('requires a base URL for a custom openai-compatible chat endpoint', () => {
    expect(validateAIConfig(cfg({ chat_provider: 'openai-compatible', chat_api_key: undefined, chat_base_url: undefined }), null))
      .toMatch(/base URL is required/)
  })

  it('requires a base URL for a custom openai-compatible embedding endpoint', () => {
    expect(
      validateAIConfig(
        cfg({ embedding_provider: 'openai-compatible', embedding_base_url: undefined }),
        null,
      ),
    ).toMatch(/base URL is required for a custom OpenAI-compatible embedding/)
  })

  it('allows a keyless local chat endpoint that has a base URL', () => {
    expect(
      validateAIConfig(
        cfg({
          chat_provider: 'openai-compatible',
          chat_api_key: undefined,
          chat_base_url: 'http://localhost:11434/v1',
          embedding_provider: 'openai-compatible',
          embedding_base_url: 'http://localhost:11434/v1',
        }),
        null,
      ),
    ).toBeNull()
  })
})
