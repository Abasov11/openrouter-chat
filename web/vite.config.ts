import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin in dev as in production: the browser only ever sees /api.
    proxy: { '/api': 'http://localhost:8787' },
  },
  // Playwright owns e2e/; vitest only runs unit tests next to the code.
  test: { include: ['src/**/*.test.ts'] },
})
