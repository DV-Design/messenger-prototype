import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { AppState, Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '../components/SafeArea';
import { ActionLink, Button, Icon, IconButton, type IconName } from '../components/ui';
import { OemCallSetup } from '../components/OemCallSetup';
import { PERMISSION_ORDER, UNKNOWN_ACCESS, hasAccess, inSequence, type Access, type PermissionKind } from '../permission-model';
import { completeSetup, readPermission, requestInitialPermissions, requestPermission } from '../permissions';
import { pushConfigured, pushUnavailable } from '../notifications';
import { errorText } from '../runtime';
import { colors, styles } from '../styles';
import { t } from '../i18n';
const details: Record<PermissionKind, { title: string; purpose: string; icon: IconName }> = {
  camera: { title: t('Camera'), purpose: t('Show yourself to the contact in video calls.'), icon: 'videocam-outline' },
  microphone: { title: t('Microphone'), purpose: t('Transmit your voice during a call.'), icon: 'mic-outline' },
  notifications: { title: t('Notifications'), purpose: t('Show a new-message notification and open the app for delivery. Android may delay notifications; the sender must remain reachable.'), icon: 'notifications-outline' },
  photos: { title: t('Photos and video'), purpose: t('Choose images and video to send. You can grant access to selected files only.'), icon: 'images-outline' },
  fullScreenCalls: { title: t('Full-screen calls'), purpose: t('Open an incoming call over the lock screen. On Android 14+ this is a separate phone setting; the app checks it after you return.'), icon: 'call-outline' },
};
const labels: Record<Access['status'], string> = { unavailable: t('Not configured'), unknown: t('Checking…'), undetermined: t('Not requested yet'), denied: t('Not allowed'), limited: t('Selected items'), granted: t('Allowed') };
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
          .then(results => { if (active && results.some(item => item.error)) setError(t('Some permissions could not be requested. You can enable them separately in settings.')); })
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
    if (results.some(item => item.error)) setError(t('Some permissions could not be requested. You can enable them separately or in phone settings.'));
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
    <View style={styles.header}>{!setup && <IconButton name="chevron-back" label={t('Back')} onPress={() => router.back()} />}<View style={styles.flex}><Text style={[styles.title, { fontSize: 25 }]}> {t('LastCall permissions')}</Text><Text style={styles.subtitle}> {t('You decide what to allow')}</Text></View></View>
    <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
      <Text style={[styles.body, { margin: 20 }]}> {t('Messaging needs no permissions. Allow the features you plan to use. You can change this later in settings.')}</Text>
      {PERMISSION_ORDER.map(kind => { const item = details[kind]; const access = values[kind]; return <View key={kind} style={[styles.section, { marginTop: 12, padding: 17, gap: 12 }]}>
        <View style={styles.row}><Icon name={item.icon} /><Text style={[styles.rowName, styles.flex]}>{item.title}</Text><Text style={[styles.info, hasAccess(access) && { color: colors.accent }]}>{kind === 'fullScreenCalls' && access.status === 'unavailable' ? t('Unavailable on this device') : labels[access.status]}</Text></View>
        <Text style={styles.body}>{item.purpose}</Text>
        {!hasAccess(access) && access.status !== 'unknown' && access.status !== 'unavailable' && (access.canAskAgain
          ? <ActionLink icon="checkmark-circle-outline" title={kind === 'fullScreenCalls' ? t('Set up full-screen calls') : t('Allow')} busy={busy === kind} disabled={!!busy && busy !== kind} onPress={() => void request(kind)} />
          : <ActionLink icon="settings-outline" title={t('Open phone settings')} disabled={!!busy} onPress={() => void settings()} />)}
        {kind === 'notifications' && !pushConfigured && <Text style={styles.info}> {t('A phone permission alone does not enable push.')} {pushUnavailable}</Text>}
        {access.status === 'denied' && access.canAskAgain && <Text style={styles.info}>{kind === 'fullScreenCalls' ? t('Access is not allowed yet. You can open settings or return later.') : t('If the system prompt no longer appears, enable access in phone settings.')}</Text>}
      </View>; })}
      <View style={{ marginHorizontal: 16, marginTop: 12 }}><OemCallSetup /></View>
      {!!error && <Text style={[styles.error, { margin: 16 }]}>{error}</Text>}
      <View style={styles.content}>{auto !== '1' && <Button title={t('Allow requested')} busy={busy === 'all'} disabled={!!busy && busy !== 'all'} onPress={() => void requestAll()} />}<Button title={setup ? t('Continue') : t('Done')} secondary busy={busy === 'done'} disabled={!!busy && busy !== 'done'} onPress={() => void finish()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 26 }}>
          {setup && <ActionLink icon="time-outline" title={t('Later')} disabled={!!busy} onPress={() => void finish()} />}
          <ActionLink icon="settings-outline" title={t('Phone settings')} disabled={!!busy} onPress={() => void settings()} />
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
