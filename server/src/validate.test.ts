import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIMITS, parseChatRequest } from './validate.ts'

test('drops empty turns (a reply stopped before its first token)', () => {
  const out = parseChatRequest({
    messages: [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'b' },
    ],
  })
  assert.deepEqual(out, [
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
  ])
})

test('trims the oldest turns past the history budget, keeps the newest', () => {
  const big = 'x'.repeat(LIMITS.messageChars)
  const messages = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: big }))
  messages.push({ role: 'user', content: 'last' })
  const out = parseChatRequest({ messages })!
  assert.equal(out.at(-1)!.content, 'last')
  assert.ok(out.reduce((n, m) => n + m.content.length, 0) <= LIMITS.historyChars)
})

test('rejects oversized messages and unknown fields sneaking in', () => {
  assert.equal(parseChatRequest({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.messageChars + 1) }] }), null)
  assert.deepEqual(parseChatRequest({ messages: [{ role: 'user', content: 'hi', name: 'x' }] }), [{ role: 'user', content: 'hi' }])
})
