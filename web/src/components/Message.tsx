import { memo } from 'react'
import { describeError } from '../lib/errors.ts'
import type { Message as MessageData } from '../lib/useChat.ts'
import { Markdown } from './Markdown.tsx'

type Props = { message: MessageData; onRetry: (id: string) => void }

// memo: while one reply streams, the finished ones above it don't re-render.
export const Message = memo(function Message({ message: m, onRetry }: Props) {
  if (m.role === 'user') {
    return (
      <li className="msg msg-user">
        <span className="sr-only">Вы:</span>
        <p className="bubble">{m.content}</p>
      </li>
    )
  }

  const waiting = m.status === 'streaming' && !m.content
  return (
    <li className="msg msg-assistant">
      <span className="sr-only">Модель:</span>
      {waiting ? (
        <p className="typing">
          <span className="dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {typingLabel(m)}
        </p>
      ) : (
        m.content && (
          <div className={m.status === 'streaming' ? 'prose is-streaming' : 'prose'}>
            <Markdown text={m.content} />
          </div>
        )
      )}

      {m.status === 'error' && m.error && (
        <div className="notice notice-error" role="alert">
          <p>
            {m.content && 'Ответ прервался. '}
            {describeError(m.error)}
          </p>
          <button type="button" className="btn btn-small" onClick={() => onRetry(m.id)}>
            Повторить
          </button>
        </div>
      )}
      {m.status === 'stopped' && (
        <p className="meta">{m.content ? 'Остановлено — показано то, что успело прийти.' : 'Остановлено до начала ответа.'}</p>
      )}
      {m.status === 'done' && m.finishReason === 'length' && (
        <p className="meta">Ответ обрезан: модель упёрлась в лимит длины.</p>
      )}
      {m.model && m.status !== 'streaming' && <p className="meta model">{m.model}</p>}
    </li>
  )
})

function typingLabel(m: MessageData) {
  if (m.retrying) return 'Модель не ответила, спрашиваем другую…'
  return m.thinking ? 'Модель думает…' : 'Модель печатает…'
}
