import type { ChatMessage } from '../../shared/protocol.ts'

export const LIMITS = {
  bodyBytes: 256 * 1024,
  messageChars: 8_000,
  historyChars: 32_000, // older turns are dropped past this; free models have small contexts anyway
}

/** Returns the messages to send upstream, or null if the request is malformed. */
export function parseChatRequest(body: unknown): ChatMessage[] | null {
  const messages = (body as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages) || messages.length === 0) return null
  const clean: ChatMessage[] = []
  for (const m of messages) {
    if (m?.role !== 'user' && m?.role !== 'assistant') return null
    if (typeof m.content !== 'string' || m.content.length > LIMITS.messageChars) return null
    if (m.content.trim() === '') continue // e.g. an answer stopped before the first token
    clean.push({ role: m.role, content: m.content })
  }
  if (clean.at(-1)?.role !== 'user') return null

  // Keep the newest turns that fit the budget.
  let total = 0
  let start = clean.length
  while (start > 0 && total + clean[start - 1].content.length <= LIMITS.historyChars) {
    total += clean[--start].content.length
  }
  return clean.slice(start)
}
