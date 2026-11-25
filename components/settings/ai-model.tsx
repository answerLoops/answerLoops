'use client'

import { useActionState, useRef, useTransition, useState, useEffect } from 'react'
import { saveAIConfigAction, clearAIConfigAction, testAIConfigAction, listModelsAction, includedEmbeddingsAvailableAction } from '@/lib/actions/ai-config'
import type { AIConnectionResult } from '@/lib/ai/test-connection'
import type { BudgetStatus } from '@/lib/billing/platform-ai-budget'
import { Button } from '@/components/ui/button'
import { useToast, Toast, ReadOnlyRow } from '@/components/settings/shared'

// Fallback lists only — shown before "Refresh models" has fetched a live
// list (or if that fetch fails), so they're allowed to go stale between
// releases without breaking anything. See lib/ai/list-models.ts for the
// live source of truth.
const CHAT_PROVIDERS = [
  {
    value: 'openai',
    label: 'OpenAI',
    placeholder: 'gpt-6-astra',
    models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    placeholder: 'claude-sonnet-4-6',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-fable-5'],
  },
  {
    value: 'google',
    label: 'Google Gemini',
    placeholder: 'gemini-2.0-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
  },
  {
    value: 'groq',
    label: 'Groq',
    placeholder: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
  },
  {
    value: 'mistral',
    label: 'Mistral',
    placeholder: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mixtral-8x22b'],
  },
  {
    value: 'xai',
    label: 'xAI (Grok)',
    placeholder: 'grok-4',
    // No hand-curated fallback — Grok models are named/versioned unlike
    // anything above, and guessing an ID here risks shipping one that never
    // existed. "Refresh models" (live from xAI's own /v1/models) is the only
    // source for this provider; until that's run, Model ID is free text.
    models: [] as string[],
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio, vLLM…)',
    placeholder: 'llama3.2',
    models: [] as string[],
  },
]

/**
 * Resolve which model to show and whether that provider's field should be a
 * dropdown or free text, given a preferred model (usually a saved config's
 * chat_model). A provider with no curated list is always free text. A
 * preferred model outside the curated list is kept and shown as free text
 * too, rather than silently swapped for the list's first entry.
 */
function resolveChatModel(providerValue: string, preferredModel?: string | null): { model: string; custom: boolean } {
  const meta = CHAT_PROVIDERS.find((p) => p.value === providerValue) ?? CHAT_PROVIDERS[0]
  if (meta.models.length === 0) return { model: preferredModel ?? '', custom: true }
  if (preferredModel && meta.models.includes(preferredModel)) return { model: preferredModel, custom: false }
  if (preferredModel) return { model: preferredModel, custom: true }
  return { model: meta.models[0], custom: false }
}

const EMBEDDING_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (Ollama, local)' },
] as const

interface AIConfig {
  chat_provider: string
  chat_model: string
  chat_api_key_set: boolean
  chat_api_key_last4: string | null
  chat_base_url: string | null
  embedding_provider: string
  embedding_model: string
  embedding_api_key_set: boolean
  embedding_api_key_last4: string | null
  embedding_base_url: string | null
}

export function AIModelSection() {
  const [config, setConfig] = useState<AIConfig | null | undefined>(undefined)
  const [chatProvider, setChatProvider] = useState('openai')
  const [embeddingProvider, setEmbeddingProvider] = useState('openai')
  // The Model ID field is a real <select> of curated models per provider, not
  // a free-text input — but a provider can have a model the curated list
  // doesn't know about yet (a brand-new release, or one only the org's own
  // account has access to), and openai-compatible providers (Ollama, LM
  // Studio, vLLM) have no fixed list at all. customModel switches to a plain
  // text input for those cases instead of silently overwriting the saved value.
  const [chatModel, setChatModel] = useState(CHAT_PROVIDERS[0].models[0])
  const [customModel, setCustomModel] = useState(false)
  const [editing, setEditing] = useState(false)
  const { toastMessage, showToast } = useToast()
  const [, startClearTransition] = useTransition()
  const [usageStatus, setUsageStatus] = useState<BudgetStatus | null>(null)
  // True when knowledge-base processing can run on included AI usage, which
  // makes the OpenAI embedding key optional for other chat providers.
  const [includedEmbeddings, setIncludedEmbeddings] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [testing, startTest] = useTransition()
  const [testResult, setTestResult] = useState<AIConnectionResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Live model list, fetched on demand rather than relying on the hardcoded
  // CHAT_PROVIDERS fallback going stale between releases. Cleared whenever
  // the provider changes, since a previous provider's list is meaningless
  // once you've switched away from it.
  const [liveModels, setLiveModels] = useState<string[] | null>(null)
  const [modelsFetching, startModelsFetch] = useTransition()
  const [modelsError, setModelsError] = useState<string | null>(null)

  function refreshModels() {
    if (!formRef.current) return
    setModelsError(null)
    const fd = new FormData(formRef.current)
    startModelsFetch(async () => {
      const res = await listModelsAction(null, fd)
      if (res.error) {
        setModelsError(res.error)
      } else if (res.models) {
        setLiveModels(res.models)
        // A live fetch just proved this model ID is real — drop out of
        // free-text mode so it shows in the dropdown like any curated one.
        if (customModel && res.models.includes(chatModel)) setCustomModel(false)
      }
    })
  }

  function runTest() {
    if (!formRef.current) return
    setTestResult(null)
    setTestError(null)
    const fd = new FormData(formRef.current)
    startTest(async () => {
      const res = await testAIConfigAction(null, fd)
      if (res.error) setTestError(res.error)
      else if (res.result) setTestResult(res.result)
    })
  }

  const [saveState, saveAction, savePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await saveAIConfigAction(prev, fd)
      if (!result?.error) {
        const updated = await fetch('/api/ai-config').then((r) => r.json())
        setConfig(updated)
        if (updated) {
          setChatProvider(updated.chat_provider)
          setEmbeddingProvider(updated.embedding_provider)
          const resolved = resolveChatModel(updated.chat_provider, updated.chat_model)
          setChatModel(resolved.model)
          setCustomModel(resolved.custom)
        }
        setEditing(false)
        showToast('AI model settings updated')
      }
      return result
    },
    null
  )

  const [clearState, clearAction, clearPending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await clearAIConfigAction(prev, fd)
      if (!result?.error) {
        setConfig(null)
        setEditing(false)
        fetch('/api/ai-config/usage-status').then((r) => r.json()).then(setUsageStatus)
      }
      return result
    },
    null
  )

  useEffect(() => {
    fetch('/api/ai-config')
      .then((r) => r.json())
      .then((data: AIConfig | null) => {
        setConfig(data)
        if (data) {
          setChatProvider(data.chat_provider)
          setEmbeddingProvider(data.embedding_provider)
          const resolved = resolveChatModel(data.chat_provider, data.chat_model)
          setChatModel(resolved.model)
          setCustomModel(resolved.custom)
        }
      })
    fetch('/api/ai-config/usage-status')
      .then((r) => r.json())
      .then(setUsageStatus)
    includedEmbeddingsAvailableAction().then(setIncludedEmbeddings, () => setIncludedEmbeddings(false))
  }, [])

  if (config === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const configured = config !== null
  const usageUsedUp = !!usageStatus && (usageStatus.chat.exhausted || usageStatus.embedding.exhausted)
  const chatMeta = CHAT_PROVIDERS.find((p) => p.value === chatProvider) ?? CHAT_PROVIDERS[0]
  // Live models (just fetched from the provider itself) win over the
  // hardcoded fallback list whenever they're available.
  const modelOptions = liveModels && liveModels.length > 0 ? liveModels : chatMeta.models
  const needsEmbedKey = chatProvider !== 'openai' || embeddingProvider === 'openai-compatible'
  const embedsOnOpenAIWithOtherChat = embeddingProvider === 'openai' && chatProvider !== 'openai'
  const showForm = !configured || editing

  return (
    <>
      {toastMessage && <Toast message={toastMessage} />}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">AI Model</p>
            <p className="text-xs text-gray-500">
              {configured
                ? `${chatMeta.label} · ${config.chat_model}`
                : usageStatus
                  ? usageUsedUp
                    ? 'You\'ve reached your AI limit — add your own provider to keep AI features running'
                    : usageStatus.tier === 'trial'
                      ? 'AI usage is included during your trial. Add your own provider to remove the limit.'
                      : 'AI usage is included up to a monthly limit. Add your own provider to remove the limit.'
                  : 'Using platform default (OPENAI_API_KEY from environment)'}
            </p>
            {!configured && usageStatus && (
              <p data-testid="included-models" className="mt-1 text-xs text-gray-500 break-words">
                Included models: Chat <code className="text-gray-700">{usageStatus.models.chat ?? 'unavailable'}</code>
                {' · '}Fast <code className="text-gray-700">{usageStatus.models.fast ?? 'unavailable'}</code>
                {' · '}Embeddings <code className="text-gray-700">{usageStatus.models.embedding ?? 'unavailable'}</code>
              </p>
            )}
            {configured && usageStatus?.embedding.included && (
              // An own chat key that can't embed: answers run on it, but
              // knowledge-base processing still runs on included usage.
              <p data-testid="included-embeddings" className="mt-1 text-xs text-gray-500 break-words">
                {usageStatus.embedding.exhausted
                  ? 'You\'ve reached your knowledge-base processing limit — add an OpenAI embedding key under Embeddings to keep importing and searching.'
                  : <>Knowledge-base processing uses included AI usage (embeddings <code className="text-gray-700">{usageStatus.models.embedding ?? 'unavailable'}</code>). Add an OpenAI embedding key under Embeddings to remove the limit.</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${configured ? 'bg-brand-100 text-brand-700' : usageUsedUp ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
              {configured ? 'Custom' : usageUsedUp ? 'Limit reached' : usageStatus ? 'Included' : 'Platform default'}
            </span>
            {configured && !editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </div>

        {/* Locked summary */}
        {configured && !editing && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 divide-y divide-gray-100">
            <ReadOnlyRow label="Chat provider" value={chatMeta.label} />
            <ReadOnlyRow label="Model" value={config.chat_model} />
            <ReadOnlyRow
              label="Chat API key"
              value={config.chat_api_key_set ? (config.chat_api_key_last4 ? `••••${config.chat_api_key_last4} (connected)` : '••••••••• (saved)') : 'Not set'}
            />
            {config.chat_base_url && <ReadOnlyRow label="Base URL" value={config.chat_base_url} />}
            <ReadOnlyRow label="Embedding provider" value={EMBEDDING_PROVIDERS.find(p => p.value === config.embedding_provider)?.label ?? config.embedding_provider} />
            <ReadOnlyRow label="Embedding model" value={config.embedding_model} />
            {config.embedding_api_key_set && (
              <ReadOnlyRow
                label="Embedding API key"
                value={config.embedding_api_key_last4 ? `••••${config.embedding_api_key_last4} (connected)` : '••••••••• (saved)'}
              />
            )}
          </div>
        )}

        {/* Edit form */}
        {showForm && (
          <form ref={formRef} key={editing ? 'edit' : 'new'} action={saveAction} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Chat provider</label>
              <select
                name="chat_provider"
                value={chatProvider}
                onChange={(e) => {
                  const value = e.target.value
                  setChatProvider(value)
                  // Switching provider invalidates the old model — re-resolve
                  // against the new provider's list rather than keeping a
                  // model ID that belongs to a different vendor.
                  const resolved = resolveChatModel(value)
                  setChatModel(resolved.model)
                  setCustomModel(resolved.custom)
                  // A previous provider's live list is meaningless here.
                  setLiveModels(null)
                  setModelsError(null)
                }}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm bg-white"
              >
                {CHAT_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-600">Model ID</label>
                <button
                  type="button"
                  onClick={refreshModels}
                  disabled={modelsFetching}
                  className="text-xs text-brand-600 hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {modelsFetching ? 'Fetching…' : 'Refresh models'}
                </button>
              </div>
              {liveModels && !modelsError && (
                <p className="text-xs text-green-700 mb-1">Showing {liveModels.length} live model{liveModels.length === 1 ? '' : 's'} from {chatMeta.label}.</p>
              )}
              {modelsError && (
                <p className="text-xs text-amber-600 mb-1 break-words">{modelsError} — showing the built-in list instead.</p>
              )}
              {modelOptions.length > 0 && !customModel ? (
                <select
                  name="chat_model"
                  value={chatModel}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') { setCustomModel(true); setChatModel(''); return }
                    setChatModel(e.target.value)
                  }}
                  className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono bg-white"
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom model ID…</option>
                </select>
              ) : (
                <>
                  <input
                    name="chat_model"
                    type="text"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    placeholder={chatMeta.placeholder}
                    className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    required
                  />
                  {modelOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setCustomModel(false); setChatModel(modelOptions[0]) }}
                      className="text-xs text-brand-600 hover:underline mt-1"
                    >
                      Choose from list instead
                    </button>
                  )}
                </>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="block text-xs font-medium text-gray-600">API key</label>
                {configured && config.chat_api_key_set
                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Key saved
                    </span>
                  : <span className="text-xs text-amber-600 font-medium">No key saved</span>
                }
              </div>
              <input
                name="chat_api_key"
                type="password"
                autoComplete="new-password"
                placeholder={configured && config.chat_api_key_set ? 'Leave blank to keep current key' : 'sk-…'}
                className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
              />
              {chatProvider === 'openai-compatible' && (
                <p className="text-xs text-gray-400 mt-1">Leave blank for local endpoints that don't require auth.</p>
              )}
            </div>

            {chatProvider === 'openai-compatible' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
                <input
                  name="chat_base_url"
                  type="url"
                  defaultValue={config?.chat_base_url ?? ''}
                  placeholder="http://localhost:11434/v1"
                  className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">Ollama: <code>http://localhost:11434/v1</code> · LM Studio: <code>http://localhost:1234/v1</code></p>
              </div>
            )}

            <hr className="border-gray-100" />

            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">Embeddings</p>
              <p className="text-xs text-gray-500 mb-2">
                OpenAI is the only provider that can handle knowledge-base processing (embeddings) today. Google Gemini and Mistral are coming soon.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Embedding provider</label>
                  <select
                    name="embedding_provider"
                    value={embeddingProvider}
                    onChange={(e) => setEmbeddingProvider(e.target.value)}
                    className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm bg-white"
                  >
                    {EMBEDDING_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Embedding model</label>
                  <input
                    name="embedding_model"
                    type="text"
                    defaultValue={config?.embedding_model ?? 'text-embedding-3-small'}
                    placeholder={embeddingProvider === 'openai-compatible' ? 'nomic-embed-text' : 'text-embedding-3-small'}
                    className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    required
                  />
                </div>

                {needsEmbedKey && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-xs font-medium text-gray-600">
                        {embedsOnOpenAIWithOtherChat
                          ? `OpenAI API key for embeddings${includedEmbeddings ? ' (optional)' : ''}`
                          : 'Embedding API key'}
                      </label>
                      {configured && config.embedding_api_key_set
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            Key saved
                          </span>
                        : <span className="text-xs text-amber-600 font-medium">No key saved</span>
                      }
                    </div>
                    <input
                      name="embedding_api_key"
                      type="password"
                      autoComplete="new-password"
                      placeholder={configured && config.embedding_api_key_set ? 'Leave blank to keep current key' : 'sk-…'}
                      className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    />
                    {embedsOnOpenAIWithOtherChat && (
                      <p className="text-xs text-gray-400 mt-1">
                        {includedEmbeddings
                          ? 'Leave blank to use included AI usage for knowledge-base processing. Add a key to remove the limit.'
                          : `Required: ${chatMeta.label} can't handle knowledge-base processing, so it needs an OpenAI key.`}
                      </p>
                    )}
                  </div>
                )}

                {embeddingProvider === 'openai-compatible' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Embedding base URL</label>
                    <input
                      name="embedding_base_url"
                      type="url"
                      defaultValue={config?.embedding_base_url ?? ''}
                      placeholder="http://localhost:11434/v1"
                      className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            {(saveState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(saveState as { error?: string }).error}</p>
            )}
            {(clearState as { error?: string } | null)?.error && (
              <p className="text-xs text-red-600">{(clearState as { error?: string }).error}</p>
            )}
            {testError && <p className="text-xs text-red-600">{testError}</p>}
            {testResult && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs space-y-1">
                {(['chat', 'embedding'] as const).map((k) => {
                  const check = testResult[k]
                  return (
                    <p key={k} className={check.ok ? 'text-green-700' : 'text-red-600'}>
                      <span className="font-medium capitalize">{k}:</span>{' '}
                      {check.ok ? (check.note ?? 'connection OK') : (check.error ?? 'failed')}
                    </p>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving…' : configured ? 'Update' : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={runTest} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              {configured && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={clearPending}
                  onClick={() => startClearTransition(() => { clearAction(new FormData()) })}
                >
                  {clearPending ? 'Clearing…' : 'Reset to platform default'}
                </Button>
              )}
            </div>
          </form>
        )}

        {!configured && (
          <p className="text-xs text-gray-400">
            No custom config — all AI calls use the platform <code>OPENAI_API_KEY</code> env var.
          </p>
        )}
      </div>
    </>
  )
}
