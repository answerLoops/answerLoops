'use client'

import { useActionState, useTransition, useState, useEffect, useCallback } from 'react'
import { createApiKeyAction, revokeApiKeyAction } from '@/lib/actions/api-keys'
import { API_SCOPES, ALL_SCOPES } from '@/lib/agent/scopes'
import { Button } from '@/components/ui/button'

interface ApiKeyRow {
  id: number
  name: string
  key_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

async function fetchApiKeys(): Promise<{ keys: ApiKeyRow[]; canManage: boolean } | null> {
  const res = await fetch('/api/api-keys')
  if (!res.ok) return null
  const data = await res.json()
  return { keys: data.keys, canManage: data.can_manage === true }
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null)
  // Whether this member may mint/revoke keys. The server action is the
  // authoritative gate — this only decides whether to render controls that
  // would be rejected anyway. Defaults to false so the controls never flash
  // in before the role is known.
  const [canManage, setCanManage] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [skillCopied, setSkillCopied] = useState(false)
  const [, startTransition] = useTransition()

  const loadKeys = useCallback(async () => {
    const data = await fetchApiKeys()
    if (!data) return
    setKeys(data.keys)
    setCanManage(data.canManage)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchApiKeys().then((data) => {
      if (cancelled || !data) return
      setKeys(data.keys)
      setCanManage(data.canManage)
    })
    return () => { cancelled = true }
  }, [])

  // Read once on mount so rendering stays pure; key expiry only needs to be
  // right as of when the page was opened.
  const [now] = useState(() => Date.now())

  const [createState, createAction, creating] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await createApiKeyAction(prev, fd)
      if (result && !result.error) {
        setNewKeyName('')
        if (result.plaintextKey) setPlaintextKey(result.plaintextKey)
        await loadKeys()
      }
      return result
    },
    null
  )

  function revoke(keyId: number) {
    setConfirmRevoke(null)
    setRevokeError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('keyId', String(keyId))
        const result = await revokeApiKeyAction(null, fd)
        if (result?.error) {
          setRevokeError(result.error)
          return
        }
        setKeys((current) => current?.filter((key) => key.id !== keyId) ?? current)
        setPlaintextKey(null)
      } catch {
        setRevokeError('Could not revoke this key. Please try again.')
        await loadKeys()
      }
    })
  }

  function copyKey() {
    if (!plaintextKey) return
    navigator.clipboard.writeText(plaintextKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const mcpConfig = `{
  "mcpServers": {
    "answerloops": {
      "url": "${baseUrl}/api/mcp",
      "headers": { "Authorization": "Bearer ${plaintextKey ?? 'al_live_xxxx'}" }
    }
  }
}`

  const operateSkillInstallCommand = `npx @answerloops/agent-sdk skills answerloops-operate`

  function copySkillCommand() {
    navigator.clipboard.writeText(operateSkillInstallCommand).then(() => {
      setSkillCopied(true)
      setTimeout(() => setSkillCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Onboard your agent</p>
            <p className="text-xs text-gray-600 mt-1">
              Install the answerLoops skill so Claude Code can search your knowledge base, read tickets,
              and generate answers against this workspace. Create an API key below first, then drop it
              into the skill&apos;s MCP config.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={copySkillCommand} className="shrink-0">
            {skillCopied ? '✓ Copied' : 'Copy command'}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <p className="text-xs text-gray-600">
          API keys let AI agents (Claude Code, Cursor, or any MCP-compatible client) call answerLoops directly —
          searching your knowledge base, checking tickets, and answering questions using your community&apos;s data,
          scoped to this org. See <a href="/docs/integrations/mcp" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">the MCP docs</a> for setup.
        </p>

        {!canManage && (
          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Only workspace owners and admins can create or revoke API keys. Ask an owner if you need one.
          </p>
        )}

        {canManage && (
        <form action={createAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              name="name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Claude Code (laptop)"
              className="w-full min-w-0 flex-1 rounded border border-gray-200 px-3 py-1.5 text-sm"
              maxLength={100}
            />
            <select
              name="expiresInDays"
              defaultValue=""
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 sm:w-auto"
              title="Expiry"
            >
              <option value="">Never expires</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
            <div className="w-full sm:w-auto">
              <Button type="submit" size="sm" disabled={creating || !newKeyName.trim()} className="w-full sm:w-auto">
                {creating ? 'Creating…' : 'Create key'}
              </Button>
            </div>
          </div>
          <fieldset className="rounded-md border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium text-gray-600">
              Permissions — the key can only do what you check here
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {ALL_SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope}
                    defaultChecked
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <code className="text-[0.6875rem] text-gray-900">{scope}</code>
                    <span className="block text-gray-500">{API_SCOPES[scope]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </form>
        )}
        {createState?.error && <p className="text-xs text-red-600">{createState.error}</p>}

        {plaintextKey && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800">Copy this now — it won&apos;t be shown again.</p>
            <div className="relative">
              <code className="block text-xs font-mono text-amber-900 bg-white border border-amber-200 rounded px-3 py-2 pr-16 break-all select-all">
                {plaintextKey}
              </code>
              <button
                type="button"
                onClick={copyKey}
                className="absolute top-2 right-2 rounded px-2 py-1 text-[0.625rem] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs font-medium text-amber-800 pt-1">Drop this in your MCP client config:</p>
            <pre className="bg-gray-950 text-emerald-400 rounded-lg p-3 text-[0.6875rem] font-mono overflow-x-auto whitespace-pre">{mcpConfig}</pre>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {keys === null ? (
          <p className="text-sm text-gray-400 p-4">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">No API keys yet.</p>
        ) : (
          keys.map((k) => {
            const expired = !!k.expires_at && new Date(k.expires_at).getTime() < now
            return (
              <div key={k.id} className={`flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${expired ? 'opacity-50' : ''}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{k.name}</p>
                  <p className="break-all text-xs font-mono text-gray-400">
                    {k.key_prefix}••••••••
                    {expired ? ' · expired' : k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}
                    {!expired && k.expires_at ? ` · expires ${new Date(k.expires_at).toLocaleDateString()}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {!k.scopes || k.scopes.length >= ALL_SCOPES.length
                      ? 'Full access'
                      : k.scopes.join(', ')}
                  </p>
                </div>
                {!canManage ? null : confirmRevoke === k.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="danger" onClick={() => revoke(k.id)}>Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(k.id)}>Revoke</Button>
                )}
              </div>
            )
          })
        )}
      </div>
      {revokeError && <p role="alert" className="text-xs text-red-600">{revokeError}</p>}
    </div>
  )
}
