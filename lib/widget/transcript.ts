import type { Message } from '@ag-ui/client'

/**
 * What the chat panel keeps in the visitor's own browser so a refresh, a move
 * to another page of the same site, or a quiet reload does not wipe the
 * conversation. Nothing here is sent anywhere: the server keeps its own memory
 * of the conversation under the visitor id, and this is only what the panel
 * redraws.
 *
 * Every function is safe to call when browser storage is blocked (private
 * windows, strict settings): reads come back empty and writes do nothing, so
 * the chat simply starts fresh.
 */

export const VISITOR_ID_STORAGE_KEY = 'al_visitor_id'

/** A conversation is forgotten this long after its last message. */
export const TRANSCRIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** The most messages kept; the oldest are dropped first. */
export const TRANSCRIPT_MAX_MESSAGES = 40
/** The most characters stored for one conversation (about 200 KB). */
export const TRANSCRIPT_MAX_CHARS = 200_000
/** The chat endpoint rejects a longer message, so a longer one is never restored. */
export const MESSAGE_MAX_CHARS = 4_000
/**
 * The chat endpoint rejects a request with more than 50 messages. Every run
 * sends the whole thread, so it is trimmed to this before each send.
 */
export const REQUEST_MAX_MESSAGES = 48

/** A question held for the automatic resend is dropped after this long. */
export const PENDING_MAX_AGE_MS = 2 * 60 * 1000
/** A second refused call this soon after an automatic recovery stops retrying. */
export const RECOVERY_WINDOW_MS = 60 * 1000

const transcriptKey = (widgetToken: string) => `al_chat:${widgetToken}`
const pendingKey = (widgetToken: string) => `al_pending:${widgetToken}`
const recoveryKey = (widgetToken: string) => `al_recovered:${widgetToken}`

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeToolCall(value: unknown): { id: string; type: 'function'; function: { name: string; arguments: string } } | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null
  const fn = value.function
  if (!isRecord(fn) || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') return null
  if (fn.arguments.length > MESSAGE_MAX_CHARS) return null
  return { id: value.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } }
}

/**
 * A stored message back into a message the chat can draw, or null when it is
 * not one. Stored data is treated as untrusted: it lives in the browser, where
 * anything on the same origin can write to it.
 */
export function sanitizeMessage(value: unknown): Message | null {
  if (!isRecord(value)) return null
  const id = value.id
  if (typeof id !== 'string' || !id || id.length > 128) return null
  const content = typeof value.content === 'string' ? value.content : ''
  if (content.length > MESSAGE_MAX_CHARS) return null

  if (value.role === 'user') {
    return content ? { id, role: 'user', content } : null
  }
  if (value.role === 'assistant') {
    const toolCalls = Array.isArray(value.toolCalls)
      ? value.toolCalls.map(sanitizeToolCall).filter((c): c is NonNullable<typeof c> => c !== null)
      : []
    if (!content && toolCalls.length === 0) return null
    return toolCalls.length > 0 ? { id, role: 'assistant', content, toolCalls } : { id, role: 'assistant', content }
  }
  if (value.role === 'tool') {
    const toolCallId = value.toolCallId
    if (typeof toolCallId !== 'string' || !toolCallId) return null
    return { id, role: 'tool', content, toolCallId }
  }
  return null
}

/** The thread starting at its first visitor message, so no reply or card result is left without its question. */
export function startAtUserMessage(messages: Message[]): Message[] {
  const first = messages.findIndex((m) => m.role === 'user')
  return first === -1 ? [] : messages.slice(first)
}

/**
 * The thread as it is sent with a new message: the newest messages only, from
 * a visitor message on, so a long conversation never goes over the endpoint's
 * message limit.
 */
export function trimForRequest(messages: Message[]): Message[] {
  if (messages.length <= REQUEST_MAX_MESSAGES) return messages
  return startAtUserMessage(messages.slice(-REQUEST_MAX_MESSAGES))
}

function fit(messages: Message[]): Message[] {
  let kept = startAtUserMessage(messages.slice(-TRANSCRIPT_MAX_MESSAGES))
  while (kept.length > 0 && JSON.stringify(kept).length > TRANSCRIPT_MAX_CHARS) {
    kept = startAtUserMessage(kept.slice(1))
  }
  return kept
}

/** The saved conversation for this widget, or an empty list when there is none, it has expired or storage is blocked. */
export function loadTranscript(widgetToken: string, now: number = Date.now()): Message[] {
  const storage = local()
  if (!storage) return []
  try {
    const raw = storage.getItem(transcriptKey(widgetToken))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.messages)) {
      storage.removeItem(transcriptKey(widgetToken))
      return []
    }
    if (now - parsed.savedAt > TRANSCRIPT_MAX_AGE_MS || parsed.savedAt > now + 60_000) {
      storage.removeItem(transcriptKey(widgetToken))
      return []
    }
    const messages = parsed.messages.map(sanitizeMessage).filter((m): m is Message => m !== null)
    return fit(messages)
  } catch {
    return []
  }
}

/** Saves the conversation (an empty one removes it). Keeps the newest messages within the size limits. */
export function saveTranscript(widgetToken: string, messages: Message[], now: number = Date.now()): void {
  const storage = local()
  if (!storage) return
  try {
    const kept = fit(messages.map(sanitizeMessage).filter((m): m is Message => m !== null))
    if (kept.length === 0) {
      storage.removeItem(transcriptKey(widgetToken))
      return
    }
    storage.setItem(transcriptKey(widgetToken), JSON.stringify({ v: 1, savedAt: now, messages: kept }))
  } catch {
    // Blocked or full: the conversation just is not kept this time.
  }
}

/**
 * Starts a fresh conversation: forgets the saved one and gives the visitor a
 * new id, so the server's memory of the old conversation is not carried into
 * the new one.
 */
export function startNewChat(widgetToken: string): void {
  try {
    local()?.removeItem(transcriptKey(widgetToken))
    local()?.setItem(VISITOR_ID_STORAGE_KEY, crypto.randomUUID())
    session()?.removeItem(pendingKey(widgetToken))
    session()?.removeItem(recoveryKey(widgetToken))
  } catch {
    // Nothing to clear if storage is blocked.
  }
}

/**
 * Prepares an automatic recovery from a refused call: remembers the question
 * to send again once the chat has reloaded. Returns false when recovery is not
 * possible (storage blocked) or already happened a moment ago, in which case
 * the visitor is shown the "timed out" prompt instead of a reload loop.
 */
export function beginRecovery(widgetToken: string, question: string, now: number = Date.now()): boolean {
  const storage = session()
  if (!storage || !question) return false
  try {
    const last = Number(storage.getItem(recoveryKey(widgetToken)))
    if (last && now - last < RECOVERY_WINDOW_MS) return false
    storage.setItem(recoveryKey(widgetToken), String(now))
    storage.setItem(pendingKey(widgetToken), JSON.stringify({ text: question, at: now }))
    return true
  } catch {
    return false
  }
}

/** The question held for an automatic resend, removed as it is read so it is sent once. */
export function takePending(widgetToken: string, now: number = Date.now()): string | null {
  const storage = session()
  if (!storage) return null
  try {
    const raw = storage.getItem(pendingKey(widgetToken))
    if (!raw) return null
    storage.removeItem(pendingKey(widgetToken))
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.text !== 'string' || typeof parsed.at !== 'number') return null
    if (!parsed.text || parsed.text.length > MESSAGE_MAX_CHARS || now - parsed.at > PENDING_MAX_AGE_MS) return null
    return parsed.text
  } catch {
    return null
  }
}
