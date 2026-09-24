import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage, ChatRole } from '../../../shared/protocol.ts'
import { ChatError, streamChat, type ClientError } from './api.ts'

export type Message = {
  id: string
  role: ChatRole
  content: string
  // assistant only:
  status?: 'streaming' | 'done' | 'stopped' | 'error'
  thinking?: boolean
  retrying?: boolean // the first model failed before answering; the server asked another
  model?: string
  finishReason?: string
  error?: ClientError
}

// sessionStorage: survives a reload (F5, a crashed tab) but not closing the tab.
const STORAGE_KEY = 'openrouter-chat:v1'

function load(): Message[] {
  try {
    const saved: Message[] = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    // A reply that was streaming when the page went away is, in effect, stopped.
    return saved.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped', thinking: false, retrying: false } : m))
  } catch {
    return []
  }
}

function save(messages: Message[]) {
  try {
    if (messages.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage full or blocked (private mode): the chat still works, it just won't survive a reload.
  }
}

// Not crypto.randomUUID(): it's missing on plain-http origins, e.g. testing from a phone over LAN.
let seq = 0
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

/** What the model sees: finished and stopped replies are context, failed ones are not. */
function toWire(history: Message[]): ChatMessage[] {
  return history
    .filter((m) => m.role === 'user' || (m.status !== 'error' && m.content.trim()))
    .map(({ role, content }) => ({ role, content }))
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>(load)
  // Stable callbacks read the current list from here instead of closing over a stale one.
  const latest = useRef(messages)
  useLayoutEffect(() => {
    latest.current = messages
  })
  const abort = useRef<AbortController | null>(null)
  const streaming = messages.some((m) => m.status === 'streaming')

  // Writing on every token is wasteful; save when a reply settles, and on page hide.
  useEffect(() => {
    if (!streaming) save(messages)
  }, [messages, streaming])
  useEffect(() => {
    const onHide = () => save(latest.current)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  const run = useCallback(async (history: Message[]) => {
    const id = newId()
    const patch = (fn: (m: Message) => Partial<Message>) =>
      setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)))
    setMessages([...history, { id, role: 'assistant', content: '', status: 'streaming' }])

    const ctrl = new AbortController()
    abort.current = ctrl
    // Tokens arrive faster than the screen refreshes; re-render (and re-parse
    // markdown) at most once per frame instead of once per token.
    let pending = ''
    let frame = 0
    const flush = () => {
      cancelAnimationFrame(frame)
      frame = 0
      if (!pending) return
      const text = pending
      pending = ''
      patch((m) => ({ content: m.content + text, thinking: false, retrying: false }))
    }

    try {
      for await (const event of streamChat(toWire(history), ctrl.signal)) {
        if (event.type === 'delta') {
          pending += event.text
          frame ||= requestAnimationFrame(flush)
        } else if (event.type === 'meta') patch(() => ({ model: event.model }))
        else if (event.type === 'thinking') patch(() => ({ thinking: true, retrying: false }))
        else if (event.type === 'retry') patch(() => ({ retrying: true, thinking: false, model: undefined }))
        else if (event.type === 'done') {
          flush()
          patch(() => ({ status: 'done', finishReason: event.finishReason }))
        }
      }
    } catch (err) {
      flush() // keep every token that made it
      if (ctrl.signal.aborted) patch(() => ({ status: 'stopped', thinking: false, retrying: false }))
      else {
        const error: ClientError = err instanceof ChatError ? err.error : { code: 'network' }
        if (!(err instanceof ChatError)) console.error(err)
        patch(() => ({ status: 'error', thinking: false, retrying: false, error }))
      }
    } finally {
      if (abort.current === ctrl) abort.current = null
    }
  }, [])

  const send = useCallback(
    (text: string) => {
      const content = text.trim()
      // abort.current is set synchronously in run(), so a double Enter can't start two replies.
      if (!content || abort.current) return false
      run([...latest.current, { id: newId(), role: 'user', content }])
      return true
    },
    [run],
  )

  /** Re-asks from the failed reply: it is replaced, everything before it is kept. */
  const retry = useCallback(
    (id: string) => {
      const ms = latest.current
      const at = ms.findIndex((m) => m.id === id)
      if (at === -1 || abort.current) return
      run(ms.slice(0, at))
    },
    [run],
  )

  const stop = useCallback(() => abort.current?.abort(), [])

  const reset = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setMessages([])
  }, [])

  return { messages, streaming, send, retry, stop, reset }
}
