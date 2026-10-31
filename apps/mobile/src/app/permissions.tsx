import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { AppState, Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, IconButton, type IconName } from '../components/ui';
import { PERMISSION_ORDER, UNKNOWN_ACCESS, hasAccess, inSequence, type Access, type PermissionKind } from '../permission-model';
import { completeSetup, readPermission, requestInitialPermissions, requestPermission } from '../permissions';
import { pushConfigured, pushUnavailable } from '../notifications';
import { errorText } from '../runtime';
import { colors, styles } from '../styles';
const details: Record<PermissionKind, { title: string; purpose: string; icon: IconName }> = {
  camera: { title: 'Камера', purpose: 'Показывать вас собеседнику в видеозвонках.', icon: 'videocam-outline' },
  microphone: { title: 'Микрофон', purpose: 'Передавать ваш голос во время звонка.', icon: 'mic-outline' },
  notifications: { title: 'Уведомления', purpose: 'Показывать уведомление о новом сообщении и открывать приложение для доставки. Android может задерживать уведомления; отправитель должен оставаться доступным.', icon: 'notifications-outline' },
  photos: { title: 'Фото и видео', purpose: 'Выбирать изображения и видео для отправки. Можно дать доступ только к выбранным файлам.', icon: 'images-outline' },
  fullScreenCalls: { title: 'Полноэкранные звонки', purpose: 'Открывать входящий звонок поверх экрана блокировки. На Android 14+ это отдельный доступ в настройках телефона; приложение проверит его после вашего возврата.', icon: 'call-outline' },
};
const labels: Record<Access['status'], string> = { unavailable: 'Не настроено', unknown: 'Проверяем…', undetermined: 'Ещё не запрошено', denied: 'Не разрешено', limited: 'Выбранные элементы', granted: 'Разрешено' };
async function currentAccess() {
  const results = await Promise.all(PERMISSION_ORDER.map(async kind => [kind, await readPermission(kind)] as const));
  return Object.fromEntries(results) as Record<PermissionKind, Access>;
}
export default function PermissionScreen() {
  const { setup, auto } = useLocalSearchParams<{ setup?: string; auto?: string }>();
  const automaticStarted = useRef(false);
  const [values, setValues] = useState<Record<PermissionKind, Access>>({ camera: UNKNOWN_ACCESS, microphone: UNKNOWN_ACCESS, photos: UNKNOWN_ACCESS, notifications: UNKNOWN_ACCESS, fullScreenCalls: UNKNOWN_ACCESS });
  const [busy, setBusy] = useState<PermissionKind | 'all' | 'done' | null>(auto === '1' ? 'all' : null);
  const [error, setError] = useState('');
  async function refresh() {
    setValues(await currentAccess());
  }
  useEffect(() => {
    void currentAccess().then(setValues).catch(cause => setError(errorText(cause)));
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh().catch(cause => setError(errorText(cause))); });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (auto !== '1') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (automaticStarted.current || AppState.currentState !== 'active') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active || automaticStarted.current || AppState.currentState !== 'active') return;
        automaticStarted.current = true; setBusy('all'); setError('');
        void requestInitialPermissions((kind, access) => { if (active) setValues(current => ({ ...current, [kind]: access })); })
          .then(results => { if (active && results.some(item => item.error)) setError('Некоторые доступы не удалось запросить. Их можно включить отдельно в настройках.'); })
          .catch(cause => { if (active) setError(errorText(cause)); })
          .finally(() => { if (active) setBusy(null); });
      }, 250);
    };
    schedule();
    const listener = AppState.addEventListener('change', value => { if (value === 'active') schedule(); });
    return () => { active = false; clearTimeout(timer); listener.remove(); };
  }, [auto]);
  async function request(kind: PermissionKind) {
    setBusy(kind); setError('');
    try { const access = await requestPermission(kind); setValues(current => ({ ...current, [kind]: access })); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(null); }
  }
  async function requestAll() {
    setBusy('all'); setError('');
    const results = await inSequence(PERMISSION_ORDER, async kind => {
      const access = await requestPermission(kind); setValues(current => ({ ...current, [kind]: access })); return access;
    });
    if (results.some(item => item.error)) setError('Некоторые доступы не удалось запросить. Их можно включить отдельно или в настройках телефона.');
    setBusy(null);
  }
  async function finish() {
    setBusy('done'); setError('');
    try { await completeSetup(); if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
    catch (cause) { setError(errorText(cause)); setBusy(null); }
  }
  async function settings() {
    try { await Linking.openSettings(); } catch (cause) { setError(errorText(cause)); }
  }
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}>{!setup && <IconButton name="chevron-back" label="Назад" onPress={() => router.back()} />}<View style={styles.flex}><Text style={[styles.title, { fontSize: 25 }]}>Доступы LastCall</Text><Text style={styles.subtitle}>Вы решаете, что разрешить</Text></View></View>
    <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
      <Text style={[styles.body, { margin: 20 }]}>Для переписки доступы не нужны. Разрешите функции, которыми планируете пользоваться. Выбор можно изменить позже в настройках.</Text>
      {PERMISSION_ORDER.map(kind => { const item = details[kind]; const access = values[kind]; return <View key={kind} style={[styles.section, { marginTop: 12, padding: 17, gap: 12 }]}>
        <View style={styles.row}><Icon name={item.icon} /><Text style={[styles.rowName, styles.flex]}>{item.title}</Text><Text style={[styles.info, hasAccess(access) && { color: colors.accent }]}>{kind === 'fullScreenCalls' && access.status === 'unavailable' ? 'Недоступно на этом устройстве' : labels[access.status]}</Text></View>
        <Text style={styles.body}>{item.purpose}</Text>
        {!hasAccess(access) && access.status !== 'unknown' && access.status !== 'unavailable' && (access.canAskAgain
          ? <Button title={kind === 'fullScreenCalls' ? 'Настроить полноэкранные звонки' : 'Разрешить'} secondary busy={busy === kind} disabled={!!busy && busy !== kind} onPress={() => void request(kind)} />
          : <Button title="Открыть настройки телефона" secondary disabled={!!busy} onPress={() => void settings()} />)}
        {kind === 'notifications' && !pushConfigured && <Text style={styles.info}>Разрешение телефона не включает push само по себе. {pushUnavailable}</Text>}
        {access.status === 'denied' && access.canAskAgain && <Text style={styles.info}>{kind === 'fullScreenCalls' ? 'Доступ пока не разрешён. Можно открыть настройки или вернуться к этому позже.' : 'Если системное окно больше не появляется, включите доступ в настройках телефона.'}</Text>}
      </View>; })}
      {!!error && <Text style={[styles.error, { margin: 16 }]}>{error}</Text>}
      <View style={styles.content}>{auto !== '1' && <Button title="Разрешить нужное" busy={busy === 'all'} disabled={!!busy && busy !== 'all'} onPress={() => void requestAll()} />}<Button title={setup ? 'Продолжить' : 'Готово'} secondary busy={busy === 'done'} disabled={!!busy && busy !== 'done'} onPress={() => void finish()} />
        {setup && <Button title="Позже" secondary disabled={!!busy} onPress={() => void finish()} />}
        <Button title="Настройки телефона" secondary disabled={!!busy} onPress={() => void settings()} />
      </View>
    </ScrollView>
  </SafeAreaView>;
}
