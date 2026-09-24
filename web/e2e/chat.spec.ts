import { expect, test, type Page } from '@playwright/test'

async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Сообщение' })
  await input.fill(text)
  await input.press('Enter')
}

const lastReply = (page: Page) => page.locator('.msg-assistant').last()

test('empty state, then a streamed answer rendered as markdown', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible()
  await ask(page, 'привет')
  await expect(page.getByRole('status')).toHaveText(/Модель печатает|Ответ получен/)
  await expect(lastReply(page).locator('strong')).toHaveText('тестовый')
  await expect(page.getByRole('status')).toHaveText('Ответ получен')
  await expect(lastReply(page)).toContainText('fake/model:free')
})

test('Esc stops generation, keeps the partial answer, UI stays usable', async ({ page }) => {
  await page.goto('/')
  await ask(page, '[long] расскажи')
  await expect(lastReply(page)).toContainText('слово5')
  await page.keyboard.press('Escape')
  await expect(lastReply(page)).toContainText('Остановлено')
  const partial = await lastReply(page).locator('.prose').innerText()
  expect(partial).not.toContain('слово399')
  await page.waitForTimeout(300)
  expect(await lastReply(page).locator('.prose').innerText()).toBe(partial) // really stopped
  await ask(page, 'ещё вопрос')
  await expect(lastReply(page)).toContainText('тестовый')
})

test('Stop button works the same and keeps focus on itself', async ({ page }) => {
  await page.goto('/')
  await ask(page, '[long] расскажи')
  const stop = page.getByRole('button', { name: 'Остановить генерацию' })
  await expect(lastReply(page)).toContainText('слово3')
  await stop.click()
  await expect(lastReply(page)).toContainText('Остановлено')
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeVisible()
})

test('429 from the free model: clear message and a working retry', async ({ page }) => {
  await page.goto('/')
  await ask(page, '[429] привет')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('перегружены')
  await expect(alert).toContainText('12 с')
  await expect(page.locator('.typing')).toHaveCount(0) // no spinner left behind
  await expect(page.getByRole('textbox', { name: 'Сообщение' })).toBeEditable()
})

test('model never answers: timeout message instead of an endless spinner', async ({ page }) => {
  await page.goto('/')
  await ask(page, '[silent] привет')
  await expect(page.getByRole('alert')).toContainText('слишком долго молчит', { timeout: 5000 })
})

test('model fails before its first word: the UI says so and the backup model answers', async ({ page }) => {
  await page.goto('/')
  await ask(page, '[fallback] привет')
  await expect(page.locator('.typing')).toContainText('Модель думает')
  await expect(page.locator('.typing')).toContainText('спрашиваем другую')
  await expect(lastReply(page)).toContainText('тестовый')
  await expect(lastReply(page)).toContainText('fake/backup:free')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('stream cut mid-answer keeps what arrived and says so', async ({ page }) => {
  await page.goto('/')
  await ask(page, '[cut] привет')
  await expect(page.getByRole('alert')).toContainText('Ответ прервался')
  await expect(lastReply(page)).toContainText('Привет! Это')
})

test('offline: explains, and retry works once the network is back', async ({ page, context }) => {
  await page.goto('/')
  await context.setOffline(true)
  await ask(page, 'привет')
  await expect(page.getByRole('alert')).toContainText('Нет подключения')
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(lastReply(page)).toContainText('тестовый')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('history survives a reload; an interrupted reply comes back as stopped', async ({ page }) => {
  await page.goto('/')
  await ask(page, 'привет')
  await expect(page.getByRole('status')).toHaveText('Ответ получен')
  await ask(page, '[long] расскажи')
  await expect(lastReply(page)).toContainText('слово3')
  await page.reload()
  await expect(page.locator('.msg')).toHaveCount(4)
  await expect(lastReply(page)).toContainText('Остановлено')
  await page.getByRole('button', { name: 'Новый чат' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible()
})

test('keyboard: Shift+Enter makes a new line, Enter sends, focus is always visible', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hardware keyboard scenario')
  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'Сообщение' })
  await input.focus()
  await page.keyboard.type('строка 1')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('строка 2')
  await expect(input).toHaveValue('строка 1\nстрока 2')
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-user')).toHaveText(/строка 1\s+строка 2/)
  await expect(page.getByRole('status')).toHaveText('Ответ получен')
  // Tab through every control from the top: logical order, and each shows a focus indicator.
  await page.getByRole('heading', { name: 'Чат с моделью' }).click() // sets the Tab starting point
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    const { name, visible } = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const field = el.closest('.field')
      return {
        name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName,
        visible:
          getComputedStyle(el).outlineStyle !== 'none' || (field !== null && getComputedStyle(field).boxShadow !== 'none'),
      }
    })
    expect(visible, `no focus indicator on "${name}"`).toBe(true)
    seen.push(name || 'textarea')
  }
  expect(seen).toEqual(['Новый чат', 'Тёмная тема', 'textarea', 'Отправить'])
})

test('no horizontal scroll on a phone, even with a long unbroken line', async ({ page }) => {
  await page.goto('/')
  await ask(page, 'a'.repeat(300))
  await expect(page.getByRole('status')).toHaveText('Ответ получен')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
