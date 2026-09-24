import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { StreamEvent } from '../../../shared/protocol.ts'
import { ChatError, streamChat } from './api.ts'

const enc = new TextEncoder()

/** A response whose body we push chunks into by hand; `close` ends it without `done`. */
function controllableResponse() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => (ctrl = c) })
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    push: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
    fail: (e: unknown) => ctrl.error(e),
  }
}

type Fake = { response: Response; fail?: (e: unknown) => void }

function mockFetch({ response, fail }: Fake) {
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    // Like real fetch: aborting the signal errors the body mid-read.
    init.signal?.addEventListener('abort', () => fail?.(new DOMException('aborted', 'AbortError')))
    return Promise.resolve(response)
  })
}

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const out: StreamEvent[] = []
  try {
    for await (const e of gen) out.push(e)
    return { out, error: null }
  } catch (error) {
    return { out, error }
  }
}

const history = [{ role: 'user' as const, content: 'hi' }]

beforeEach(() => vi.stubGlobal('navigator', { onLine: true }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('yields deltas in order and stops at done', async () => {
  const r = controllableResponse()
  mockFetch(r)
  r.push('event: delta\ndata: {"text":"Прив"}\n\nevent: del')
  r.push('ta\ndata: {"text":"ет"}\n\nevent: done\ndata: {"finishReason":"stop"}\n\n')
  const { out, error } = await collect(streamChat(history, new AbortController().signal))
  expect(error).toBeNull()
  expect(out).toEqual([
    { type: 'delta', text: 'Прив' },
    { type: 'delta', text: 'ет' },
    { type: 'done', finishReason: 'stop' },
  ])
})

test('server error event becomes a ChatError with its code', async () => {
  const r = controllableResponse()
  mockFetch(r)
  r.push('event: error\ndata: {"code":"rate_limited","retryAfterSec":20}\n\n')
  const { error } = await collect(streamChat(history, new AbortController().signal))
  expect(error).toBeInstanceOf(ChatError)
  expect((error as ChatError).error).toEqual({ code: 'rate_limited', retryAfterSec: 20 })
})

test('connection closed without done is reported, not treated as a finished answer', async () => {
  const r = controllableResponse()
  mockFetch(r)
  r.push('event: delta\ndata: {"text":"половина"}\n\n')
  r.close()
  const { out, error } = await collect(streamChat(history, new AbortController().signal))
  expect(out).toHaveLength(1)
  expect((error as ChatError).error.code).toBe('upstream_unavailable')
})

test('non-JSON error page (proxy in front of us) still maps to a known code', async () => {
  mockFetch({ response: new Response('<html>502 Bad Gateway</html>', { status: 502 }) })
  const { error } = await collect(streamChat(history, new AbortController().signal))
  expect((error as ChatError).error.code).toBe('upstream_unavailable')
})

test('45 s of silence ends with timeout instead of an endless spinner', async () => {
  vi.useFakeTimers()
  const r = controllableResponse()
  mockFetch(r)
  r.push('event: delta\ndata: {"text":"a"}\n\n')
  let settled = false
  const done = collect(streamChat(history, new AbortController().signal)).finally(() => (settled = true))
  await vi.advanceTimersByTimeAsync(44_000)
  r.push(': ping\n\n') // keep-alive resets the watchdog
  await vi.advanceTimersByTimeAsync(44_000)
  expect(settled).toBe(false) // 88 s in, but never 45 s of silence
  await vi.advanceTimersByTimeAsync(46_000)
  const { out, error } = await done
  expect(out).toHaveLength(1)
  expect((error as ChatError).error.code).toBe('timeout')
})

test('Stop is not an error: the AbortError passes through untouched', async () => {
  const r = controllableResponse()
  mockFetch(r)
  const stop = new AbortController()
  r.push('event: delta\ndata: {"text":"a"}\n\n')
  const gen = streamChat(history, stop.signal)
  expect((await gen.next()).value).toEqual({ type: 'delta', text: 'a' })
  const pending = gen.next()
  stop.abort()
  const error = await pending.catch((e) => e)
  expect(error).not.toBeInstanceOf(ChatError)
})

test('offline before sending fails fast without a request', async () => {
  vi.stubGlobal('navigator', { onLine: false })
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  const { error } = await collect(streamChat(history, new AbortController().signal))
  expect((error as ChatError).error.code).toBe('offline')
  expect(fetchSpy).not.toHaveBeenCalled()
})

test('before the stream opens it waits longer: the server may be trying other models', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
  )
  let settled = false
  const done = collect(streamChat(history, new AbortController().signal)).finally(() => (settled = true))
  await vi.advanceTimersByTimeAsync(74_000)
  expect(settled).toBe(false) // longer than the 45 s mid-stream silence budget
  await vi.advanceTimersByTimeAsync(2_000)
  expect(((await done).error as ChatError).error.code).toBe('timeout')
})
