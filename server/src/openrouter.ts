import type { ApiError, ChatMessage, ErrorCode, StreamEvent } from '../../shared/protocol.ts'
import { createSseParser } from '../../shared/sse.ts'

export type UpstreamOptions = {
  apiKey: string
  models: string[] // first is primary, the rest are OpenRouter-side fallbacks
  firstTokenTimeoutMs: number
  idleTimeoutMs: number
  fetchImpl?: typeof fetch
}

export class UpstreamError extends Error {
  readonly error: ApiError
  constructor(error: ApiError, detail?: string) {
    super(detail ?? error.code)
    this.error = error
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Streams one completion from OpenRouter as our own StreamEvents.
 * Throws UpstreamError for anything the user should see; if `signal` fires
 * (the browser went away or pressed Stop) it aborts the upstream request too
 * and throws the AbortError — the caller decides it is not an error.
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  signal: AbortSignal,
  opts: UpstreamOptions,
): AsyncGenerator<StreamEvent> {
  const upstream = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      upstream.abort()
    }, ms)
  }
  const onAbort = () => upstream.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const fail = (err: unknown): never => {
    if (timedOut) throw new UpstreamError({ code: 'timeout' })
    if (signal.aborted) throw err
    if (err instanceof UpstreamError) throw err
    throw new UpstreamError({ code: 'upstream_unavailable' }, String(err))
  }

  // Until the model says anything we wait longer: free models queue for a while.
  arm(opts.firstTokenTimeoutMs)
  try {
    let res: Response
    try {
      res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'openrouter-chat',
        },
        body: JSON.stringify({ models: opts.models, messages, stream: true }),
        signal: upstream.signal,
      })
    } catch (err) {
      return fail(err)
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw errorFromUpstream(res.status, body, res.headers.get('retry-after'))
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    const parse = createSseParser()
    let sentMeta = false
    let sentThinking = false
    let finishReason: string | undefined
    while (true) {
      let chunk: ReadableStreamReadResult<string>
      try {
        chunk = await reader.read()
      } catch (err) {
        return fail(err)
      }
      if (chunk.done) break
      for (const { data } of parse(chunk.value)) {
        if (data === '[DONE]') {
          yield { type: 'done', finishReason: finishReason ?? 'stop' }
          return
        }
        let json: any
        try {
          json = JSON.parse(data)
        } catch {
          continue // not ours to crash on
        }
        // OpenRouter reports failures after HTTP 200 as an `error` chunk.
        if (json.error) throw errorFromUpstream(Number(json.error.code) || 502, JSON.stringify(json), null)
        if (!sentMeta && typeof json.model === 'string') {
          sentMeta = true
          yield { type: 'meta', model: json.model }
        }
        const choice = json.choices?.[0]
        const text = choice?.delta?.content
        if (text) {
          arm(opts.idleTimeoutMs)
          yield { type: 'delta', text }
        } else if (choice?.delta?.reasoning) {
          arm(opts.idleTimeoutMs) // thinking is progress too
          if (!sentThinking) {
            sentThinking = true
            yield { type: 'thinking' }
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason
      }
    }
    // Body ended without [DONE]. With a finish_reason the answer is complete;
    // without one the connection was cut mid-answer.
    if (finishReason) yield { type: 'done', finishReason }
    else throw new UpstreamError({ code: 'upstream_unavailable' }, 'stream ended without finish_reason')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    upstream.abort() // no-op when finished; releases the socket if the consumer stopped early
  }
}

export function errorFromUpstream(status: number, body: string, retryAfterHeader: string | null): UpstreamError {
  let retryAfterSec = Number(retryAfterHeader) || undefined
  try {
    const meta = JSON.parse(body)?.error?.metadata
    retryAfterSec ??= Number(meta?.retry_after_seconds) || undefined
  } catch {}
  const code: ErrorCode =
    status === 429
      ? 'rate_limited'
      : status === 408 || status === 504
        ? 'timeout'
        : status === 400
          ? 'bad_request'
          : status === 401 || status === 402 || status === 403 || status === 404
            ? 'server_misconfigured' // bad key, no credit, model removed — fix on our side
            : 'upstream_unavailable'
  const error: ApiError = code === 'rate_limited' && retryAfterSec ? { code, retryAfterSec } : { code }
  return new UpstreamError(error, `upstream ${status}: ${body.slice(0, 300)}`)
}
