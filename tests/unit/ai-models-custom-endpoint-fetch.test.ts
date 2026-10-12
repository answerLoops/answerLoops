import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createOpenAI: vi.fn(() => ({ embedding: vi.fn(), chat: vi.fn() })) }))
vi.mock('@ai-sdk/openai', () => ({ openai: vi.fn(), createOpenAI: h.createOpenAI }))
vi.mock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: vi.fn() }))
vi.mock('@/lib/billing/plans', () => ({ getDeploymentMode: () => 'cloud' }))

import { buildChatProvider, buildEmbeddingModel } from '@/lib/ai/models'

function opts() {
  return (h.createOpenAI.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0]
}

beforeEach(() => h.createOpenAI.mockClear())

describe('custom base URLs use the pinned provider fetch', () => {
  it('openai-compatible with a base URL', () => {
    buildChatProvider('openai-compatible', 'k', 'https://llm.example.com/v1')
    expect(typeof opts().fetch).toBe('function')
  })
  it('xai with a tenant base URL', () => {
    buildChatProvider('xai', 'k', 'https://proxy.example.com/v1')
    expect(typeof opts().fetch).toBe('function')
  })
  it('xai without a base URL keeps the default fetch', () => {
    buildChatProvider('xai', 'k', null)
    expect(opts().fetch).toBeUndefined()
  })
  it('openai-compatible without a base URL keeps the default fetch', () => {
    buildChatProvider('openai-compatible', 'k', null)
    expect(opts().fetch).toBeUndefined()
  })
  it('embeddings with a base URL', () => {
    buildEmbeddingModel('m', 'k', 'https://emb.example.com/v1')
    expect(typeof opts().fetch).toBe('function')
  })
  it('embeddings without a base URL keep the default fetch', () => {
    buildEmbeddingModel('m', 'k', null)
    expect(opts().fetch).toBeUndefined()
  })
})
