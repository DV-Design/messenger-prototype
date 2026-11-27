/**
 * Our Telegram bot, long-polling (no inbound webhook): `/start <token>` shows one button that shares
 * the person's own number; a shared contact is accepted only when it is the sender's own.
 * The token never leaves the process; Telegram ids are not stored.
 */
export interface TelegramContact { phone: string; ownerId: number | undefined; fromId: number }
export interface TelegramHandlers {
  /** A deep link was opened. Returns false when the token is unknown or expired. */
  start(token: string, chatId: number): boolean;
  /** A shared contact for the session opened in this chat. */
  contact(chatId: number, contact: TelegramContact): 'ok' | 'not-own' | 'anonymous' | 'invalid' | 'no-session';
}
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
interface Update { update_id: number; message?: { chat?: { id?: number; type?: string }; from?: { id?: number; language_code?: string; is_bot?: boolean }; text?: string; contact?: { phone_number?: string; user_id?: number } } }

const TEXT = {
  ru: {
    ask: 'Чтобы войти в LastCall, нажмите кнопку ниже: бот получит ваш номер телефона из Telegram. Номер нужен для входа, восстановления аккаунта и поиска знакомых.',
    button: '📱 Отправить мой номер',
    done: 'Номер подтверждён. Вернитесь в LastCall.',
    expired: 'Ссылка устарела. Вернитесь в LastCall и начните заново.',
    notOwn: 'Нужен ваш собственный номер: нажмите кнопку «Отправить мой номер», а не пересылайте чужой контакт.',
    anonymous: 'Анонимные номера без SIM-карты не подходят.',
    invalid: 'Не удалось распознать номер. Попробуйте ещё раз.',
    hello: 'Это бот входа в LastCall. Откройте его из приложения LastCall или отправьте сюда код из приложения (например, ABCD-EFGH).',
    badCode: 'Код не подошёл или устарел. Проверьте код в приложении LastCall или начните заново.',
  },
  en: {
    ask: 'To sign in to LastCall, tap the button below: the bot gets your phone number from Telegram. The number is used for signing in, restoring your account and finding people you know.',
    button: '📱 Share my number',
    done: 'Number confirmed. Go back to LastCall.',
    expired: 'This link has expired. Go back to LastCall and start again.',
    notOwn: 'Share your own number with the "Share my number" button, not someone else\'s contact.',
    anonymous: 'Anonymous numbers without a SIM card are not accepted.',
    invalid: 'Could not read the number. Try again.',
    hello: 'This is the LastCall sign-in bot. Open it from the LastCall app, or send the code shown in the app (like ABCD-EFGH).',
    badCode: 'This code is wrong or has expired. Check the code in the LastCall app or start again.',
  },
};

export class TelegramBot {
  private offset = 0;
  private running = false;
  private controller?: AbortController;
  private loop?: Promise<void>;
  username?: string;
  constructor(private token: string, private handlers: TelegramHandlers, private fetchImpl: Fetch = fetch as unknown as Fetch, private pauseMs = 5000) {
    if (!/^[0-9]{5,16}:[A-Za-z0-9_-]{30,64}$/.test(token)) throw new Error('Invalid TELEGRAM_BOT_TOKEN');
  }
  private async call(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const value = await response.json() as { ok?: boolean; result?: unknown };
    // Never put the response or the URL into an error: the URL carries the token.
    if (!response.ok || !value?.ok) throw new Error(`Telegram ${method} failed (${response.status})`);
    return value.result;
  }
  async start() {
    const me = await this.call('getMe', {}) as { username?: string };
    if (!me?.username || !/^[A-Za-z0-9_]{5,32}$/.test(me.username)) throw new Error('Telegram getMe returned no username');
    this.username = me.username;
    this.running = true;
    this.loop = this.poll();
  }
  linkFor(token: string) { return `https://t.me/${this.username}?start=${token}`; }
  private async poll() {
    while (this.running) {
      this.controller = new AbortController();
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message'] }, this.controller.signal) as Update[];
        for (const update of updates ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.handle(update).catch(() => console.error('Telegram update handling failed'));
        }
      } catch {
        if (!this.running) return;
        console.error('Telegram polling failed; retrying');
        await new Promise(resolve => setTimeout(resolve, this.pauseMs));
      }
    }
  }
  /** Exposed for tests: one update as Telegram would deliver it. */
  async handle(update: Update) {
    const message = update.message; const chatId = message?.chat?.id; const fromId = message?.from?.id;
    if (!message || typeof chatId !== 'number' || typeof fromId !== 'number' || message.chat?.type !== 'private' || message.from?.is_bot) return;
    console.info(`telegram: update (${message.contact ? 'contact' : message.text?.startsWith('/start') ? 'start' : 'text'})`);
    const text = message.from?.language_code?.startsWith('ru') ? TEXT.ru : TEXT.en;
    if (message.contact) {
      const result = this.handlers.contact(chatId, { phone: String(message.contact.phone_number ?? ''), ownerId: message.contact.user_id, fromId });
      if (result === 'ok') return this.send(chatId, text.done, { remove_keyboard: true });
      if (result === 'no-session') return this.send(chatId, text.expired, { remove_keyboard: true });
      return this.send(chatId, result === 'not-own' ? text.notOwn : result === 'anonymous' ? text.anonymous : text.invalid);
    }
    const typed = /^\s*([A-Za-z2-9]{4}-?[A-Za-z2-9]{4})\s*$/.exec(message.text ?? '');
    if (typed) {
      if (!this.handlers.start(typed[1]!, chatId)) return this.send(chatId, text.badCode);
      return this.send(chatId, text.ask, { keyboard: [[{ text: text.button, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
    }
    const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{16,64}))?\s*$/.exec(message.text ?? '');
    if (!start) return this.send(chatId, text.hello);
    if (!start[1] || !this.handlers.start(start[1], chatId)) return this.send(chatId, start[1] ? text.expired : text.hello);
    return this.send(chatId, text.ask, { keyboard: [[{ text: text.button, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
  }
  private async send(chatId: number, text: string, reply_markup?: unknown) {
    await this.call('sendMessage', { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) });
  }
  async stop() {
    this.running = false; this.controller?.abort();
    await this.loop?.catch(() => undefined);
  }
}
