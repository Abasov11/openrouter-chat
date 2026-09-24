import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSseParser, formatSse } from './sse.ts'

test('parses events split at arbitrary points', () => {
  const feed = createSseParser()
  const wire = formatSse('delta', { text: 'При' }) + ': ping\n\n' + formatSse('done', { finishReason: 'stop' })
  const out = []
  for (let i = 0; i < wire.length; i += 3) out.push(...feed(wire.slice(i, i + 3)))
  assert.deepEqual(out, [
    { event: 'delta', data: '{"text":"При"}' },
    { event: 'done', data: '{"finishReason":"stop"}' },
  ])
})

test('handles CRLF even when \\r and \\n arrive in different chunks', () => {
  const feed = createSseParser()
  assert.deepEqual(feed('data: a\r\n\r'), [])
  assert.deepEqual(feed('\ndata: b\r\n\r\n'), [
    { event: 'message', data: 'a' },
    { event: 'message', data: 'b' },
  ])
})

test('joins multi-line data and ignores comment-only blocks', () => {
  const feed = createSseParser()
  assert.deepEqual(feed(': OPENROUTER PROCESSING\n\ndata: 1\ndata: 2\n\n'), [{ event: 'message', data: '1\n2' }])
})
