// Our real server (validation, SSE, abort, timeouts) with a scripted OpenRouter behind it,
// so the browser tests can reproduce 429s, stalls and cut streams on demand.
// The upstream behaviour is picked by a marker in the last user message.
import { fileURLToPath } from 'node:url'
import { createApp } from '../../server/src/app.ts'

const enc = new TextEncoder()
const data = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`)

const fakeFetch: typeof fetch = async (_url, init) => {
  const { messages, models } = JSON.parse(String(init!.body))
  const prompt: string = messages.at(-1).content
  const signal = init!.signal!
  const model: string = models[0]
  const chunk = (content: string, finish: string | null = null) =>
    data({ model, choices: [{ delta: { content }, finish_reason: finish }] })

  if (prompt.includes('[429]')) {
    return new Response(JSON.stringify({ error: { code: 429, metadata: { retry_after_seconds: 12 } } }), { status: 429 })
  }
  const words = prompt.includes('[long]')
    ? Array.from({ length: 400 }, (_, i) => `слово${i} `)
    : ['Привет', '! ', 'Это ', '**тестовый** ', 'ответ.']
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
      if (prompt.includes('[silent]')) return // never says anything → first-token timeout
      if (prompt.includes('[fallback]') && model === PRIMARY) {
        // Thinks, then OpenRouter gives up on it before a single visible word.
        c.enqueue(data({ model, choices: [{ delta: { reasoning: '…' } }] }))
        await new Promise((r) => setTimeout(r, 800))
        c.enqueue(data({ model, choices: [], error: { code: 504, message: 'The operation was aborted' } }))
        return c.close()
      }
      if (prompt.includes('[fallback]')) await new Promise((r) => setTimeout(r, 800)) // backup model queues a bit
      for (const [i, w] of words.entries()) {
        if (signal.aborted) return
        c.enqueue(chunk(w))
        if (prompt.includes('[cut]') && i === 2) return c.close() // connection dies mid-answer
        await new Promise((r) => setTimeout(r, 40))
      }
      if (signal.aborted) return
      c.enqueue(chunk('', 'stop'))
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
    },
  })
  return new Response(stream, { status: 200 })
}



const PRIMARY = 'fake/model:free'

createApp({
  upstream: { apiKey: 'fake', models: [PRIMARY, 'fake/backup:free'], firstTokenTimeoutMs: 1500, idleTimeoutMs: 1500, fetchImpl: fakeFetch },
  staticRoot: fileURLToPath(new URL('../dist', import.meta.url)),
  rateLimit: { limit: 10_000, windowMs: 60_000 },
}).listen(4173, () => console.log('fake server on http://localhost:4173'))
