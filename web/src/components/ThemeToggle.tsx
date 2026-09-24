import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'openrouter-chat:theme'

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initial)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {}
  }

  return (
    <button type="button" className="btn btn-icon" aria-pressed={theme === 'dark'} onClick={toggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">Тёмная тема</span>
    </button>
  )
}
