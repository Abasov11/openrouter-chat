import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'

const apiKey = process.env.OPENROUTER_API_KEY?.trim()
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set. Copy .env.example to .env and put your key there.')
  process.exit(1)
}

const models = (process.env.OPENROUTER_MODELS ?? 'nvidia/nemotron-3-super-120b-a12b:free,nex-agi/nex-n2.5-mini:free,google/gemma-4-31b-it:free')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

const dist = fileURLToPath(new URL('../../web/dist', import.meta.url))
const staticRoot = process.env.NODE_ENV === 'production' && existsSync(dist) ? dist : undefined
const port = Number(process.env.PORT) || 8787

createApp({
  upstream: { apiKey, models, firstTokenTimeoutMs: 20_000, idleTimeoutMs: 30_000 },
  staticRoot,
}).listen(port, () => {
  console.log(`http://localhost:${port}  models: ${models.join(', ')}${staticRoot ? '' : '  (API only; run the Vite dev server for the UI)'}`)
})
