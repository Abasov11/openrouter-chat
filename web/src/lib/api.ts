import type { ChatMessage, ErrorCode, StreamEvent } from '../../../shared/protocol.ts'
import { createSseParser } from '../../../shared/sse.ts'

/** Server error codes plus the ones only the browser can observe. */
export type ClientErrorCode = ErrorCode | 'network' | 'offline'
export type ClientError = { code: ClientErrorCode; retryAfterSec?: number }

export class ChatError extends Error {
  readonly error: ClientError
  constructor(error: ClientError) {
    super(error.code)
    this.error = error
  }
}

// The server writes a ping every 15 s, so this much silence means the connection is dead.
const SILENCE_MS = 45_000

/**
 * POSTs the conversation and yields server events as they arrive.
 * EventSource can't POST, hence fetch + a stream reader.
 * On `signal` abort it throws the AbortError untouched — Stop is not an error.
 */
export async function* streamChat(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
  if (!navigator.onLine) throw new ChatError({ code: 'offline' })

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let silent = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      silent = true
      ctrl.abort()
    }, SILENCE_MS)
  }
  const fail = (err: unknown): never => {
    if (silent) throw new ChatError({ code: 'timeout' })
    if (signal.aborted || err instanceof ChatError) throw err
    throw new ChatError({ code: navigator.onLine ? 'network' : 'offline' })
  }

  arm()
  try {
    let res: Response
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: ctrl.signal,
      })
    } catch (err) {
      return fail(err)
    }
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null)
      // No JSON means the error came from something in front of our server (dev proxy, nginx).
      throw new ChatError(body?.error?.code ? body.error : { code: 'upstream_unavailable' })
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    const parse = createSseParser()
    while (true) {
      let chunk: ReadableStreamReadResult<string>
      try {
        chunk = await reader.read()
      } catch (err) {
        return fail(err)
      }
      if (chunk.done) break
      arm() // any bytes, pings included, prove the connection is alive
      for (const { event, data } of parse(chunk.value)) {
        const payload = JSON.parse(data)
        if (event === 'error') throw new ChatError(payload)
        const known = event === 'meta' || event === 'thinking' || event === 'delta' || event === 'done'
        if (!known) continue
        yield { type: event, ...payload } as StreamEvent
        if (event === 'done') return
      }
    }
    // Connection closed without `done` or `error`: cut somewhere between us and the server.
    throw new ChatError({ code: 'upstream_unavailable' })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    ctrl.abort()
  }
}
