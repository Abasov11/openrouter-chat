// Contract between the browser and our server. The browser never talks to OpenRouter.

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = { role: ChatRole; content: string }

export type ChatRequest = { messages: ChatMessage[] }

export type ErrorCode =
  | 'rate_limited' // upstream (free model pool) said 429
  | 'too_many_requests' // our own per-IP limit
  | 'timeout' // no first token / stream went silent
  | 'upstream_unavailable' // network failure or stream cut mid-answer
  | 'bad_request' // request failed our validation
  | 'server_misconfigured' // missing/invalid key, model gone — not the user's fault

export type ApiError = { code: ErrorCode; retryAfterSec?: number }

// Streamed as SSE: `event: <type>\ndata: <json without type>\n\n`
export type StreamEvent =
  | { type: 'meta'; model: string }
  | { type: 'thinking' } // reasoning model started thinking; sent once
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: string }
  | ({ type: 'error' } & ApiError)
