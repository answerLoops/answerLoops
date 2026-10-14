/**
 * Telegram message ids are only unique within one chat, so tickets created
 * from Telegram store `telegram:<chatId>:<messageId>` as their
 * source_message_id. Tickets created before this format existed hold the bare
 * message id; dedupe checks both forms.
 */
export function telegramSourceMessageId(chatId: string | number, messageId: string | number): string {
  return `telegram:${chatId}:${messageId}`
}

/** The bare Telegram message id from either the namespaced or the legacy stored form. */
export function telegramMessageIdFromSource(sourceMessageId: string): string {
  if (!sourceMessageId.startsWith('telegram:')) return sourceMessageId
  const idx = sourceMessageId.lastIndexOf(':')
  return sourceMessageId.slice(idx + 1)
}
