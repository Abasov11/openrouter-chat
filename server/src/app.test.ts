import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import { createSseParser } from '../../shared/sse.ts'
import { createApp } from './app.ts'

// A fake OpenRouter: each test scripts what the upstream stream does.
type Script = (ctl: { send: (obj: unknown) => void; raw: (s: string) => void; end: () => void }, signal: AbortSignal) => void
let script: Script = () => {}
let lastUpstream: { signal: AbortSignal; body: any } | undefined
let upstreamStatus: { status: number; body: string; headers?: Record<string, string> } | undefined

const fakeFetch: typeof fetch = async (_url, init) => {
  const signal = init!.signal!
  lastUpstream = { signal, body: JSON.parse(String(init!.body)) }
  if (upstreamStatus) return new Response(upstreamStatus.body, upstreamStatus)
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
      script(
        {
          send: (obj) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)),
          raw: (s) => c.enqueue(enc.encode(s)),
          end: () => c.close(),
        },
        signal,
      )
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const chunk = (content: string, finish: string | null = null) => ({
  model: 'test/model:free',
  choices: [{ delta: { content }, finish_reason: finish }],
})

async function start(timeoutMs: number) {
  const server = createApp({
    upstream: { apiKey: 'k', models: ['a:free', 'b:free'], firstTokenTimeoutMs: timeoutMs, idleTimeoutMs: timeoutMs, fetchImpl: fakeFetch },
    rateLimit: { limit: 1000, windowMs: 60_000 },
  })
  await new Promise<void>((r) => server.listen(0, r))
  after(() => server.close())
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
const base = await start(200)
// Timeouts far beyond the test: only the client disconnect can abort upstream here.
const patientBase = await start(60_000)

function reset() {
  script = () => {}
  lastUpstream = undefined
  upstreamStatus = undefined
}

async function chat(body: unknown = { messages: [{ role: 'user', content: 'hi' }] }, signal?: AbortSignal, url = base) {
  return fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

async function events(res: Response) {
  const feed = createSseParser()
  const out: { event: string; data: any }[] = []
  for await (const text of res.body!.pipeThrough(new TextDecoderStream())) {
    for (const e of feed(text)) out.push({ event: e.event, data: JSON.parse(e.data) })
  }
  return out
}

test('streams deltas and finishes with done', async () => {
  reset()
  script = (c) => {
    c.raw(': OPENROUTER PROCESSING\n\n')
    c.send({ model: 'test/model:free', choices: [{ delta: { content: '', reasoning: 'hmm' } }] })
    c.send(chunk('При'))
    c.send(chunk('вет', 'stop'))
    c.raw('data: [DONE]\n\n')
    c.end()
  }
  const res = await chat()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  assert.deepEqual(await events(res), [
    { event: 'meta', data: { model: 'test/model:free' } },
    { event: 'thinking', data: {} },
    { event: 'delta', data: { text: 'При' } },
    { event: 'delta', data: { text: 'вет' } },
    { event: 'done', data: { finishReason: 'stop' } },
  ])
  assert.deepEqual(lastUpstream!.body.models, ['a:free', 'b:free'])
})

test('upstream 429 before the stream becomes a real HTTP 429 with Retry-After', async () => {
  reset()
  upstreamStatus = {
    status: 429,
    body: JSON.stringify({ error: { code: 429, metadata: { retry_after_seconds: 7 } } }),
  }
  const res = await chat()
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '7')
  assert.deepEqual(await res.json(), { error: { code: 'rate_limited', retryAfterSec: 7 } })
})

test('bad key does not leak upstream details to the browser', async () => {
  reset()
  upstreamStatus = { status: 401, body: '{"error":{"message":"No auth credentials found"}}' }
  const res = await chat()
  assert.equal(res.status, 500)
  assert.deepEqual(await res.json(), { error: { code: 'server_misconfigured' } })
})

test('error chunk after HTTP 200 becomes an error event, partial text already sent', async () => {
  reset()
  script = (c) => {
    c.send(chunk('Нача'))
    c.send({ error: { code: 429, message: 'rate limited' } })
    c.end()
  }
  const out = await events(await chat())
  assert.deepEqual(out.at(-2), { event: 'delta', data: { text: 'Нача' } })
  assert.deepEqual(out.at(-1), { event: 'error', data: { code: 'rate_limited' } })
})

test('stream cut without finish_reason is reported, not treated as done', async () => {
  reset()
  script = (c) => {
    c.send(chunk('Нача'))
    c.end()
  }
  const out = await events(await chat())
  assert.deepEqual(out.at(-1), { event: 'error', data: { code: 'upstream_unavailable' } })
})

test('no first token in time → 504 timeout and the upstream request is aborted', async () => {
  reset()
  script = (c) => c.raw(': OPENROUTER PROCESSING\n\n') // keep-alives are not progress
  const res = await chat()
  assert.equal(res.status, 504)
  assert.deepEqual(await res.json(), { error: { code: 'timeout' } })
  assert.equal(lastUpstream!.signal.aborted, true)
})

test('stream going silent mid-answer → timeout event', async () => {
  reset()
  script = (c) => c.send(chunk('Нача'))
  const out = await events(await chat())
  assert.deepEqual(out.at(-1), { event: 'error', data: { code: 'timeout' } })
})

test('Stop in the browser aborts the request to OpenRouter', async () => {
  reset()
  script = (c) => c.send(chunk('Нача')) // then keeps generating forever
  const browser = new AbortController()
  const res = await chat(undefined, browser.signal, patientBase)
  const reader = res.body!.getReader()
  await reader.read() // first bytes arrived — generation is in progress
  browser.abort()
  await reader.read().catch(() => {})
  for (let i = 0; i < 100 && !lastUpstream!.signal.aborted; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(lastUpstream!.signal.aborted, true)
})

test('rejects malformed requests without calling upstream', async () => {
  reset()
  for (const body of [{}, { messages: [] }, { messages: [{ role: 'system', content: 'x' }] }, { messages: [{ role: 'assistant', content: 'x' }] }]) {
    const res = await chat(body)
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  const res = await fetch(`${base}/api/chat`, { method: 'POST', body: '{"messages":[]}' }) // text/plain: CSRF-able
  assert.equal(res.status, 400)
  assert.equal(lastUpstream, undefined)
})
