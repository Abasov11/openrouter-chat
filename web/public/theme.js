// Set the theme before first paint, so a dark-mode user doesn't see a white flash.
// A file, not an inline script: the Content-Security-Policy allows scripts from 'self' only.
try {
  var t = localStorage.getItem('openrouter-chat:theme')
  document.documentElement.dataset.theme =
    t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
} catch {}
