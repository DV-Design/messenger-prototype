import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import type { Conversation } from '@messenger/core';
import { ActionLink, Icon, SettingsPage, connectionLabel } from '../../components/ui';
import { errorText, useMessenger } from '../../runtime';
import { connectionNeedsUser, isTransientConnectionError } from '../../connection-supervisor';
import { isAccountMoved } from '../../email-flow-model';
import { callDiagnosticLines } from '../../system-calls';
import { formatMediaDiagnostics, sanitizeDiagnostic } from '../../diagnostics';
import { colors, styles } from '../../styles';
import { t } from '../../i18n';

export default function ConnectionSettings() {
  const { profile, identity, snapshot, error, boundEmail } = useMessenger();
  const [localError, setLocalError] = useState('');
  const [reportCopied, setReportCopied] = useState(false);
  // Automatic retries own transient connection failures; only actionable errors reach the screen.
  const visibleError = localError || [error, snapshot.error].find(text => text && !isAccountMoved(text) && !isTransientConnectionError(text));
  const routeLabel = (item: Conversation) => item.session?.route === 'direct' ? t('P2P direct') : item.session?.route === 'relay' ? t('via TURN') : t('route unknown');
  async function copyDiagnostics() {
    const privateValues = [profile?.displayName ?? '', profile?.username ?? '', boundEmail?.email ?? '', identity?.userId ?? '', identity?.publicKey ?? '', identity?.privateKey ?? '',
      ...snapshot.contacts.flatMap(user => [user.displayName, user.username, user.userId, user.publicKey]),
      ...snapshot.conversations.flatMap(item => [item.title, ...item.messages.map(message => message.text)])];
    const sanitize = (value?: string) => sanitizeDiagnostic(value, privateValues);
    const peers = snapshot.conversations.filter(item => item.kind === 'direct');
    const report = [`LastCall ${Constants.expoConfig?.version ?? ''}`,
      t('Platform: {os} {version}', { os: Platform.OS, version: String(Platform.Version) }),
      `Directory: ${snapshot.status}`,
      t('Direct connections: {count}', { count: peers.length }),
      t('App error: {error}', { error: sanitize(snapshot.error) }),
      ...peers.flatMap((item, index) => [t('Contact {index}: {status} / {route} / {error}', {
        index: index + 1,
        status: item.session?.status ?? 'idle',
        route: item.session?.route ?? 'unknown',
        error: sanitize(item.session?.error),
      }), ...formatMediaDiagnostics(item.session?.stats)]), ...await callDiagnosticLines()].join('\n');
    try { await Clipboard.setStringAsync(report); setReportCopied(true); }
    catch (cause) { setLocalError(errorText(cause)); }
  }
  return <SettingsPage title={t('Connection')}>
    <View style={[styles.section, { marginTop: 16 }]}>
      <View style={styles.listRow}><Icon name={snapshot.status === 'online' ? 'checkmark-circle' : 'cloud-offline-outline'} color={snapshot.status === 'online' ? colors.accent : colors.secondary} /><View style={styles.rowBody}><Text style={styles.rowName}>{snapshot.status === 'error' && connectionNeedsUser(snapshot.error ?? error) ? t('Not connected') : connectionLabel[snapshot.status]}</Text><Text style={styles.rowText}>{t('Status and contact search')}</Text></View></View>
    </View>
    {!!visibleError && <Text accessibilityRole="alert" style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{visibleError}</Text>}
    <Text style={styles.sectionTitle}>{t('DIAGNOSTICS')}</Text>
    <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
      <Text selectable style={styles.info}>{t('Profile key: {key}', { key: identity?.userId ?? '' })}</Text>
      {snapshot.conversations.filter(item => item.kind === 'direct').map(item => <View key={item.id} style={{ gap: 5 }}><Text style={styles.rowName}>{item.title}</Text><Text style={styles.info}>{t('Connection: {status} · {route}', { status: item.session?.status ?? t('not established'), route: routeLabel(item) })}</Text>{formatMediaDiagnostics(item.session?.stats).map(line => <Text key={line} style={styles.info}>{line}</Text>)}</View>)}
      <Text style={styles.info}>{t('“—” means WebRTC has not provided the metric yet. Separate conversations use independent connections.')}</Text>
      <ActionLink icon="copy-outline" title={t('Copy connection report')} onPress={() => void copyDiagnostics()} />
      {reportCopied && <Text style={styles.info}>{t('Report copied. Known names, messages, phone numbers and identifiers are hidden. Review the text before sending.')}</Text>}
    </View>
  </SettingsPage>;
}
