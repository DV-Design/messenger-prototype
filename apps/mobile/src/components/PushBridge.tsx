import { useEffect, useSyncExternalStore } from 'react';
import { client, reconnect, useMessenger } from '../runtime';
import { listenForWake, nativePushToken, onPushRefresh, pushConfigured, pushUnavailable } from '../notifications';
let status = pushConfigured ? 'Ожидаем подключения к серверу' : pushUnavailable;
const listeners = new Set<() => void>();
const publish = (value: string) => { status = value; listeners.forEach(listener => listener()); };
export const usePushStatus = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
export function PushBridge() {
  const { snapshot, profile, identity } = useMessenger();
  useEffect(() => {
    if (!pushConfigured || !profile || !identity) return;
    let active = true;
    let running = false;
    let rotatedToken: string | undefined;
    async function register() {
      if (running || !active) return;
      if (client().getSnapshot().status !== 'online') { publish('Ожидаем подключения к серверу'); return; }
      running = true;
      const current = client();
      let success = false;
      try {
        const services = await current.getServices();
        if (!active || current !== client()) return;
        if (!services.push) { publish('Уведомления не настроены на сервере'); return; }
        const token = rotatedToken ?? await nativePushToken();
        if (!active || current !== client()) return;
        if (!token) { publish('Разрешите уведомления в доступах приложения'); return; }
        await current.registerPushToken(token); success = true;
        if (active) { if (rotatedToken === token) rotatedToken = undefined; publish('FCM зарегистрирован. Реальная доставка зависит от сети и Android.'); }
      } catch { if (active) publish('Не удалось зарегистрировать FCM. Проверьте сеть, Firebase и Google Play Services.'); }
      finally { running = false; if (active && success && rotatedToken) { const retryToken = rotatedToken; rotatedToken = undefined; queueMicrotask(() => { rotatedToken = retryToken; void register(); }); } }
    }
    const stopWake = listenForWake(() => { void reconnect().then(register); }, token => { rotatedToken = token; void register(); });
    const stopRefresh = onPushRefresh(() => { void register(); });
    if (snapshot.status === 'online') void register();
    return () => { active = false; stopWake(); stopRefresh(); };
  }, [snapshot.status, profile, identity]);
  return null;
}
