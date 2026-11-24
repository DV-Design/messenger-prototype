import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Text, View } from 'react-native';
import type { MessageRequest } from '@messenger/core';
import { Avatar, Button, SettingsPage, SwitchRow } from '../components/ui';
import { client, errorText, useMessenger } from '../runtime';
import { styles } from '../styles';
import { t } from '../i18n';

/**
 * People who wrote first without being contacts. Nothing of theirs is opened or saved here until
 * accepted; calls, notifications and a direct connection (which shows each other's IP address)
 * are separate choices.
 */
export default function Requests() {
  const { profile, snapshot } = useMessenger();
  const requests = snapshot.messageRequests ?? [];
  if (!profile) return <Redirect href="/onboarding" />;
  return <SettingsPage title={t('Message requests')}>
    <Text style={[styles.info, { marginHorizontal: 16, marginTop: 12 }]}>{t('These people are not in your contacts. Their messages stay encrypted on the server and are not opened until you accept. They cannot call you, wake your phone or connect to it directly.')}</Text>
    {requests.length === 0 ? <Text style={[styles.body, { textAlign: 'center', marginTop: 28 }]}>{t('No message requests.')}</Text>
      : requests.map(request => <RequestCard key={request.user.userId} request={request} />)}
  </SettingsPage>;
}

function RequestCard({ request }: { request: MessageRequest }) {
  const [push, setPush] = useState(true);
  const [direct, setDirect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { user } = request;
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <View style={[styles.section, { paddingVertical: 12 }]}>
    <View style={[styles.row, { gap: 12, paddingHorizontal: 16 }]}>
      <Avatar name={user.displayName} id={user.userId} size={46} />
      <View style={styles.rowBody}><Text style={styles.rowName}>{user.displayName}</Text>
        <Text style={styles.rowText}>@{user.username} · {request.waiting ? t('Messages waiting: {count}', { count: request.waiting }) : t('Wants to start a chat')}</Text></View>
    </View>
    <SwitchRow icon="call-outline" title={t('Calls and notifications')} subtitle={t('They can call you and wake your phone with notifications')} value={push} onValueChange={setPush} disabled={busy} />
    <SwitchRow icon="swap-horizontal-outline" title={t('Direct connection')} subtitle={t('Files and calls go phone to phone; you see each other’s IP address')} value={direct} onValueChange={setDirect} disabled={busy} />
    {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginHorizontal: 16 }]}>{error}</Text>}
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      <View style={{ flex: 1 }}><Button title={t('Accept')} busy={busy} onPress={() => void run(async () => { const id = await client().acceptRequest(user.userId, { push, direct }); router.replace({ pathname: '/chat/[id]', params: { id } }); })} /></View>
      <View style={{ flex: 1 }}><Button secondary title={t('Decline')} disabled={busy} onPress={() => void run(() => client().declineRequest(user.userId))} /></View>
    </View>
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><Button danger title={t('Block')} disabled={busy} onPress={() => void run(() => client().blockRequest(user.userId))} /></View>
  </View>;
}
