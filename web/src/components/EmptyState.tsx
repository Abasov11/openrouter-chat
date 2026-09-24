const SUGGESTIONS = [
  'Объясни, как работает HTTPS, на пальцах',
  'Составь план тренировок на неделю для новичка',
  'Напиши на TypeScript функцию debounce с комментариями',
  'Придумай пять названий для маленькой кофейни',
]

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">С чего начнём?</h2>
      <p>
        Отвечает бесплатная модель через OpenRouter. Иногда она занята — тогда скажем об этом и предложим
        повторить.
      </p>
      <ul className="suggestions" aria-label="Примеры вопросов">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button type="button" className="suggestion" onClick={() => onPick(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
      <p className="fine">Переписка живёт только в этой вкладке: переживёт обновление страницы, но не закрытие.</p>
    </section>
  )
}
