import { AppState, NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { MessengerClient, OpenedPushPreview } from '@messenger/core';
import { messagePreviewScope, registerMessengerObserver, withMessagePreviewClient } from './runtime';
import { IncomingMessageTracker, PreviewDeduper, messagePreviewBody, notificationIdentity, parseMessagePreview, type SeenPreview } from './push-preview-model';

type NativePresenter = { prepare(): Promise<boolean>; show(id: string, title: string, body: string, conversationId: string, scope: string): Promise<boolean>; contains(id: string): Promise<boolean> };
const nativePresenter = NativeModules.LastCallNotifications as NativePresenter | undefined;
export const MESSAGE_PREVIEW_CHANNEL = 'lastcall-message-previews';
const directory = () => new Directory(Paths.document, 'message-notifications');
const ledgerFile = () => new File(directory(), 'seen-v1.json');
const deduper = new PreviewDeduper({
  load: async () => {
    const target = ledgerFile();
    if (!target.exists) return null;
    if (target.size > 131_072) throw new Error('Notification ledger exceeds limit');
    return JSON.parse(await target.text()) as unknown;
  },
  save: async (entries: SeenPreview[]) => {
    const folder = directory(); folder.create({ intermediates: true, idempotent: true });
    const temporary = new File(folder, 'seen-v1.next');
    await temporary.write(JSON.stringify(entries));
    await temporary.move(ledgerFile(), { overwrite: true });
  },
  contains: async id => !!nativePresenter && await nativePresenter.contains(id),
});
let prepared: Promise<boolean> | undefined;
/** Explicit capability: Android native channel+dedup storage are available. Never asks permissions. */
export function prepareMessagePreviews(): Promise<boolean> {
  if (Platform.OS !== 'android' || !nativePresenter || typeof nativePresenter.show !== 'function' || typeof nativePresenter.contains !== 'function' || typeof nativePresenter.prepare !== 'function') return Promise.resolve(false);
  if (!prepared) prepared = (async () => {
    await Notifications.setNotificationChannelAsync(MESSAGE_PREVIEW_CHANNEL, {
      name: 'Текст сообщений LastCall', description: 'Имя отправителя и текст сообщения на экране блокировки',
      importance: AndroidImportance.HIGH, lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
      sound: 'default', enableVibrate: true, showBadge: true,
    });
    if (!(await nativePresenter.prepare())) return false;
    await deduper.prepare();
    return true;
  })().catch(() => false).then(success => { if (!success) prepared = undefined; return success; });
  return prepared;
}
type DisplayPreview = Pick<OpenedPushPreview, 'kind' | 'senderId' | 'conversationId' | 'messageId' | 'text' | 'displayName'> & { truncated?: boolean };
async function displayPreview(manager: MessengerClient, preview: DisplayPreview, allowed: () => boolean) {
  if (Platform.OS !== 'android' || AppState.currentState === 'active' || !allowed()) return;
  if (!(await prepareMessagePreviews()) || !(await Notifications.getPermissionsAsync()).granted) return;
  const scope = messagePreviewScope(manager);
  if (!scope) return;
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
    notificationIdentity(scope, preview.senderId, preview.conversationId, preview.messageId, preview.kind));
  const scopeHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
  await deduper.run(`lastcall-message-${digest}`, async () => {
    if (!allowed() || AppState.currentState === 'active') return false;
    const shown = await nativePresenter?.show(`lastcall-message-${digest}`, preview.displayName, messagePreviewBody(preview.text, preview.truncated), preview.conversationId, scopeHash) ?? false;
    return shown;
  });
}
/** Authenticated preview only. This never adds a chat record or acknowledges delivery. */
export async function processMessagePreview(payload: unknown, manager?: MessengerClient, signal?: AbortSignal): Promise<void> {
  const parsed = parseMessagePreview(payload);
  if (!parsed || Platform.OS !== 'android' || signal?.aborted || AppState.currentState === 'active') return;
  const allowed = () => !signal?.aborted && parsed.intent.expiresAt > Date.now();
  const open = async (current: MessengerClient) => {
    if (!allowed()) return;
    const preview = await current.openPushPreview(parsed.envelope, parsed.intent);
    await displayPreview(current, preview, allowed);
  };
  try { if (manager) await open(manager); else await withMessagePreviewClient(open); }
  catch { /* Unknown pair, expired/tampered preview, locked storage or denied OS permission: no plaintext. */ }
}

const trackers = new WeakMap<MessengerClient, IncomingMessageTracker>();
registerMessengerObserver((snapshot, manager) => {
  let tracker = trackers.get(manager);
  if (!tracker) { tracker = new IncomingMessageTracker(); trackers.set(manager, tracker); }
  const incoming = tracker.next(snapshot);
  if (Platform.OS !== 'android' || AppState.currentState === 'active' || !incoming.length) return;
  // The first received snapshot precedes core's durable write. Never mistake that emit for a committed record.
  void manager.flushState().then(async () => {
    for (const preview of incoming) {
      const conversation = manager.getSnapshot().conversations.find(item => item.id === preview.conversationId);
      const record = preview.kind === 'file'
        ? conversation?.files.find(file => file.id === preview.messageId && file.senderId === preview.senderId && file.deliveryStatus === 'received' && file.status === 'complete' && file.blobKey)
        : conversation?.messages.find(message => message.id === preview.messageId && message.from === preview.senderId && message.status === 'received');
      if (record) await displayPreview(manager, preview, () => !record.expiresAt || record.expiresAt > Date.now());
    }
  }).catch(() => { /* A failed encrypted save must not produce a durable-received notification. */ });
});
