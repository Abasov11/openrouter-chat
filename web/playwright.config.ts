import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run build && node e2e/fake-server.ts',
    url: 'http://localhost:4173/api/health',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
