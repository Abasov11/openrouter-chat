import type { ClientError } from './api.ts'

/** What the person sees for each failure. Plain words, and what to do next. */
export function describeError({ code, retryAfterSec }: ClientError): string {
  const wait = retryAfterSec ? ` Попробуйте через ${retryAfterSec} с.` : ' Попробуйте через минуту.'
  switch (code) {
    case 'rate_limited':
      return 'Бесплатные модели сейчас перегружены и не приняли запрос.' + wait
    case 'too_many_requests':
      return 'Слишком много сообщений подряд.' + wait
    case 'timeout':
      return 'Модель слишком долго молчит, запрос прерван. Попробуйте ещё раз.'
    case 'upstream_unavailable':
      return 'Связь с моделью оборвалась. Попробуйте ещё раз.'
    case 'network':
      return 'Не удалось связаться с сервером. Проверьте подключение и повторите.'
    case 'offline':
      return 'Нет подключения к интернету. Когда связь появится, нажмите «Повторить».'
    case 'bad_request':
      return 'Сервер не принял сообщение: возможно, оно слишком длинное.'
    case 'server_misconfigured':
      return 'Сервис временно не работает, и дело не в вас. Попробуйте позже.'
  }
}
