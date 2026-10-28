import type { MessengerSnapshot, SessionSnapshot } from '@messenger/core';
export function transportNotice(input: { directory: MessengerSnapshot['status']; group: boolean; peerOnline?: boolean; session?: SessionSnapshot; pending: number }): { text: string; warning: boolean } {
  if (!input.group && input.session?.status === 'connected') return { text: input.pending ? 'Связь с собеседником установлена. Ожидаем подтверждения доставки.' : 'Соединение с собеседником установлено.', warning: false };
  if (input.directory !== 'online') return { text: 'Нет связи с сервером. Сообщения и файлы ожидают доставки на устройстве до 7 дней.', warning: true };
  if (input.group) return { text: input.pending ? 'Ещё не все участники подтвердили доставку. Телефоны синхронизируют данные при подключении; ожидание — до 7 дней.' : 'Данные группы синхронизируются напрямую между телефонами участников.', warning: input.pending > 0 };
  if (input.session?.status === 'error' || input.session?.error) return { text: 'Сервер подключён, но связь с собеседником не установлена. Повторяем автоматически; сообщения ждут на устройстве.', warning: true };
  if (!input.peerOnline) return { text: 'Собеседник не в сети. Сообщения и файлы ждут на этом устройстве до 7 дней, пока оба участника не станут доступны.', warning: input.pending > 0 };
  return { text: input.pending || input.session ? 'Сервер подключён. Соединяемся с собеседником; сообщения отправятся автоматически.' : 'Собеседник в сети. Защищённое соединение установится при отправке сообщения или звонке.', warning: false };
}
