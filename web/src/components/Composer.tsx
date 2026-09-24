import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

type Props = {
  streaming: boolean
  onSend: (text: string) => boolean
  onStop: () => void
}

export function Composer({ streaming, onSend, onStop }: Props) {
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const canSend = !streaming && draft.trim() !== ''

  // Grow with the text up to a cap (CSS max-height), then scroll.
  useLayoutEffect(() => {
    const el = input.current!
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (canSend && onSend(draft)) setDraft('')
    input.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter that confirms an IME candidate (Chinese, Japanese…) must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="field">
        <label htmlFor="prompt" className="sr-only">
          Сообщение
        </label>
        <textarea
          id="prompt"
          ref={input}
          rows={1}
          value={draft}
          maxLength={8000}
          placeholder="Напишите сообщение…"
          aria-describedby="composer-hint"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          // On phones autofocus pops the keyboard over the empty state before the person chose to type.
          autoFocus={matchMedia('(hover: hover)').matches}
        />
        {/* One element that changes role, not two swapped buttons: focus stays put when generation starts or ends.
            aria-disabled instead of disabled for the same reason — a disabled button drops focus. */}
        <button
          type={streaming ? 'button' : 'submit'}
          className={streaming ? 'send is-stop' : 'send'}
          aria-disabled={!streaming && !canSend}
          onClick={streaming ? onStop : undefined}
        >
          {streaming ? <StopIcon /> : <SendIcon />}
          <span className="sr-only">{streaming ? 'Остановить генерацию' : 'Отправить'}</span>
        </button>
      </div>
      <p id="composer-hint" className="hint">
        {streaming ? 'Esc — остановить' : 'Enter — отправить, Shift+Enter — новая строка'}
      </p>
    </form>
  )
}

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
)
