import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Composer } from './components/Composer.tsx'
import { EmptyState } from './components/EmptyState.tsx'
import { Message } from './components/Message.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { describeError } from './lib/errors.ts'
import { useChat, type Message as MessageData } from './lib/useChat.ts'

export default function App() {
  const { messages, streaming, send, retry, stop, reset } = useChat()

  // Esc stops generation wherever focus is, not only in the text field.
  useEffect(() => {
    if (!streaming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streaming, stop])

  // Follow the answer as it grows, unless the person scrolled up to read.
  const scroller = useRef<HTMLElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages])
  const onScroll = () => {
    const el = scroller.current!
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const sendAndFollow = useCallback(
    (text: string) => {
      pinned.current = true
      return send(text)
    },
    [send],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Чат с моделью</h1>
        <div className="topbar-actions">
          {messages.length > 0 && (
            <button type="button" className="btn" onClick={reset}>
              Новый чат
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="chat" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 ? (
          <EmptyState onPick={sendAndFollow} />
        ) : (
          <>
            <h2 className="sr-only">Переписка</h2>
            <ol className="messages" aria-busy={streaming}>
              {messages.map((m) => (
                <Message key={m.id} message={m} onRetry={retry} />
              ))}
            </ol>
          </>
        )}
      </main>

      <Composer streaming={streaming} onSend={sendAndFollow} onStop={stop} />

      {/* Screen readers get state changes, not every token (a live message list would read them all). */}
      <p className="sr-only" role="status">
        {announce(messages.at(-1))}
      </p>
    </div>
  )
}

function announce(last: MessageData | undefined): string {
  if (last?.role !== 'assistant') return ''
  switch (last.status) {
    case 'streaming':
      return last.thinking ? 'Модель думает' : 'Модель печатает'
    case 'done':
      return 'Ответ получен'
    case 'stopped':
      return 'Генерация остановлена'
    case 'error':
      return last.error ? describeError(last.error) : ''
    default:
      return ''
  }
}
