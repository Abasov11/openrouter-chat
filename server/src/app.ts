import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { ApiError, ErrorCode, StreamEvent } from '../../shared/protocol.ts'
import { formatSse } from '../../shared/sse.ts'
import { streamWithFallback, UpstreamError, type UpstreamOptions } from './openrouter.ts'
import { createRateLimiter } from './rateLimit.ts'
import { serveStatic } from './static.ts'
import { LIMITS, parseChatRequest } from './validate.ts'

export type AppOptions = {
  upstream: UpstreamOptions
  staticRoot?: string // built client; omitted in dev, Vite serves it
  rateLimit?: { limit: number; windowMs: number }
  heartbeatMs?: number
}

const STATUS: Record<ErrorCode, number> = {
  rate_limited: 429,
  too_many_requests: 429,
  timeout: 504,
  upstream_unavailable: 502,
  bad_request: 400,
  server_misconfigured: 500,
}

export function createApp(opts: AppOptions) {
  const rateLimit = createRateLimiter(opts.rateLimit?.limit ?? 20, opts.rateLimit?.windowMs ?? 60_000)

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://x')
    try {
      if (pathname === '/api/chat' && req.method === 'POST') return await handleChat(req, res)
      if (pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true })
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
      if (opts.staticRoot && req.method === 'GET') return await serveStatic(opts.staticRoot, req, res)
      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      console.error('unhandled', err)
      if (!res.headersSent) sendError(res, { code: 'upstream_unavailable' })
      else res.end()
    }
  })

  async function handleChat(req: IncomingMessage, res: ServerResponse) {
    // Behind a reverse proxy this would be X-Forwarded-For from a trusted hop.
    const limited = rateLimit(req.socket.remoteAddress ?? 'unknown')
    if (!limited.ok) return sendError(res, { code: 'too_many_requests', retryAfterSec: limited.retryAfterSec })

    // application/json forces a CORS preflight we never answer, so other sites can't use our key.
    if (!req.headers['content-type']?.startsWith('application/json')) return sendError(res, { code: 'bad_request' })
    const raw = await readBody(req, LIMITS.bodyBytes)
    let messages = null
    try {
      messages = raw === null ? null : parseChatRequest(JSON.parse(raw))
    } catch {}
    if (!messages) return sendError(res, { code: 'bad_request' })

    // 'close' on the response fires when the browser aborts (Stop, tab closed, network drop).
    const client = new AbortController()
    res.on('close', () => client.abort())

    const events = streamWithFallback(messages, client.signal, opts.upstream)
    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      // Hold headers until the first event, so errors before the stream
      // starts get a real HTTP status (429 is visible as 429 in DevTools).
      const first = await events.next()
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
      })
      // Keeps idle connections alive through proxies while a model is queued.
      heartbeat = setInterval(() => res.write(': ping\n\n'), opts.heartbeatMs ?? 15_000)
      if (!first.done) write(res, first.value)
      for await (const event of events) write(res, event)
    } catch (err) {
      if (client.signal.aborted) return // user left or pressed Stop — nothing to report
      if (!(err instanceof UpstreamError)) throw err
      console.warn(`[chat] ${err.error.code}: ${err.message}`)
      if (!res.headersSent) return sendError(res, err.error)
      write(res, { type: 'error', ...err.error })
    } finally {
      clearInterval(heartbeat)
    }
    res.end()
  }
}

function write(res: ServerResponse, { type, ...data }: StreamEvent) {
  res.write(formatSse(type, data))
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, error: ApiError) {
  const headers: Record<string, string> = error.retryAfterSec ? { 'Retry-After': String(error.retryAfterSec) } : {}
  sendJson(res, STATUS[error.code], { error }, headers)
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        resolve(null)
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
