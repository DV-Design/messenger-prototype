import { Linking } from 'react-native';
import { telegramAppLink } from '@messenger/core';

/**
 * Opens the bot in the Telegram app through its own tg:// scheme (no browser hop that may lose the
 * start parameter), and only then falls back to the t.me web link.
 */
export async function openTelegramBot(url: string): Promise<void> {
  const app = telegramAppLink(url);
  if (app) {
    try { await Linking.openURL(app); return; } catch { /* Telegram is not installed: try the web link. */ }
  }
  await Linking.openURL(url);
}
