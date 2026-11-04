import { useState } from 'react';
import { router } from 'expo-router';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import type { Conversation } from '@messenger/core';
import { callDiagnosticLines, enableSystemCalls, useSystemCallStatus } from '../../system-calls';
import { Avatar, Button, Icon, ScreenHeader, connectionLabel } from '../../components/ui';
import { AccountMovedNotice } from '../../components/AccountMovedNotice';
import { EmailBinding } from '../../components/EmailBinding';
import { isAccountMoved } from '../../email-flow-model';
import { client, deleteAccount, errorText, useMessenger } from '../../runtime';
import { connectionNeedsUser, isTransientConnectionError } from '../../connection-supervisor';
import { OemCallSetup } from '../../components/OemCallSetup';
import { formatMediaDiagnostics, sanitizeDiagnostic } from '../../diagnostics';
import { usePushStatus } from '../../components/PushBridge';
import { checkForUpdate, directUpdates, downloadAndInstallUpdate, useUpdateState } from '../../updates';
import { colors, styles } from '../../styles';
import { t } from '../../i18n';

export default function Settings() {
  const { profile, identity, snapshot, error, boundEmail, retired } = useMessenger();
  const pushStatus = usePushStatus();
  const callStatus = useSystemCallStatus();
  const updateState = useUpdateState();
  const availableUpdate = updateState.status === 'available' ? updateState.update : undefined;
  const updateStatusText = updateState.status === 'checking' ? t('Checking for updates…')
    : availableUpdate ? t('Version {version} is available', { version: availableUpdate.version })
      : updateState.status === 'current' ? t('You have the latest version')
        : updateState.status === 'error' ? t('Could not check for updates')
          : t('Not checked yet');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [localError, setLocalError] = useState('');
  const [copied, setCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Automatic retries own transient connection failures; only actionable errors reach the screen.
  const visibleError = localError || [error, snapshot.error].find(text => text && !isAccountMoved(text) && !isTransientConnectionError(text));
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

  function routeLabel(item: Conversation) {
    return item.session?.route === 'direct' ? t('P2P direct') : item.session?.route === 'relay' ? t('via TURN') : t('route unknown');
  }

  return <SafeAreaView style={styles.screen} edges={['top']}><ScreenHeader title={t('Settings')} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 35 }}>
      <View style={styles.profile}><Avatar name={profile?.displayName ?? ''} id={identity?.userId} size={86} /><Text style={styles.profileName}>{profile?.displayName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Copy username')} onPress={() => { void Clipboard.setStringAsync(`@${profile?.username ?? ''}`).then(() => setCopied(true)).catch(cause => setLocalError(errorText(cause))); }}><Text style={styles.profileUsername}>@{profile?.username}</Text></Pressable>{copied && <Text style={styles.info}>{t('Username copied')}</Text>}
        <Text style={[styles.info, { marginTop: 12, textAlign: 'center' }]}>{t('Login is confirmed by the server and bound to this device key.')}</Text></View>
      {retired && <AccountMovedNotice />}
      <Text style={styles.sectionTitle}>{t('ACCESS')}</Text>
      <View style={[styles.section, { marginTop: 0 }]}><Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/permissions')}><Icon name="shield-checkmark-outline" /><Text style={[styles.rowName, styles.flex]}>{t('App permissions')}</Text><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable></View>
      <Text style={styles.sectionTitle}>{t('CONNECTION')}</Text>
      <View style={[styles.section, { marginTop: 0 }]}>
        <View style={styles.listRow}><Icon name={snapshot.status === 'online' ? 'checkmark-circle' : 'cloud-offline-outline'} color={snapshot.status === 'online' ? colors.accent : colors.secondary} /><View style={styles.rowBody}><Text style={styles.rowName}>{snapshot.status === 'error' && connectionNeedsUser(snapshot.error ?? error) ? t('Not connected') : connectionLabel[snapshot.status]}</Text><Text style={styles.rowText}>{t('Status and contact search')}</Text></View></View>
      </View>
      {!!visibleError && <Text style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{visibleError}</Text>}
      <Text style={styles.sectionTitle}>{t('NOTIFICATIONS')}</Text><View style={[styles.section, styles.content]}><Text style={styles.body}>{pushStatus}</Text><Button title={t('Configure permissions')} secondary onPress={() => router.push('/permissions')} /></View>
      {Platform.OS === 'android' && <><Text style={styles.sectionTitle}>{t('SYSTEM CALLS')}</Text><View style={[styles.section, styles.content]}><Text style={styles.body}>{callStatus}</Text><Text style={styles.info}>{t('On Android 8+ LastCall registers its own phone account and shows its own incoming-call screen; no manual setup in the Phone app is needed. The screen appears after the encrypted call invitation is verified; connecting the peer may continue after you answer. On Android 14+ allow full-screen notifications, otherwise the call stays a normal notification. The microphone is enabled only after you answer. On Android 7 LastCall uses its own notification and screen without the Phone app.')}</Text><Button title={t('Open call settings')} secondary onPress={() => void enableSystemCalls().catch(cause => setLocalError(errorText(cause)))} /><OemCallSetup /></View></>}
      {directUpdates && Platform.OS === 'android' && <><Text style={styles.sectionTitle}>{t('UPDATES')}</Text>
        <View style={[styles.section, { marginTop: 0 }]}>
          <View style={styles.listRow}>
            <Icon name="cloud-download-outline" color={availableUpdate ? colors.accent : colors.secondary} />
            <View style={styles.rowBody}><Text style={styles.rowName}>LastCall · {updateState.currentVersion}</Text><Text style={styles.rowText}>{updateStatusText}</Text></View>
          </View>
          <View style={styles.content}>
            {availableUpdate ? <>
              {!!availableUpdate.notes && <Text style={styles.body}>{availableUpdate.notes}</Text>}
              <Button title={updating ? t('Downloading and verifying…') : t('Download and install {version}', { version: availableUpdate.version })} busy={updating} onPress={() => {
                if (updating) return;
                setUpdating(true); setLocalError('');
                void downloadAndInstallUpdate(availableUpdate).catch(() => setLocalError(t('Could not download or verify the update. Try again later.'))).finally(() => setUpdating(false));
              }} />
              <Text style={styles.info}>{t('The APK is downloaded in the app, verified by SHA-256, then handed to the Android system installer. Your profile, key, contacts and history are preserved.')}</Text>
            </> : <Button title={t('Check for updates')} secondary busy={updateState.status === 'checking'} onPress={() => void checkForUpdate(true)} />}
            {updateState.status === 'current' && <Text style={styles.info}>{t('You have the latest published version.')}</Text>}
            {!!updateState.error && <Text accessibilityRole="alert" style={styles.error}>{updateState.error}</Text>}
            <Text style={styles.info}>{t('The check uses the official LastCall website and does not use your profile server.')}</Text>
          </View>
        </View>
      </>}
      <Text style={styles.sectionTitle}>{t('BLOCKED CONTACTS')}</Text>
      <View style={styles.section}><View style={styles.content}>
        {snapshot.blockedContacts.length === 0 ? <Text style={styles.body}>{t('No blocked contacts.')}</Text> : snapshot.blockedContacts.map(userId => {
          const contact = snapshot.contacts.find(item => item.userId === userId);
          return <View key={userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text numberOfLines={1} style={[styles.rowName, styles.flex]}>{contact?.displayName ?? userId}</Text>
            <Button title={t('Unblock')} secondary onPress={() => void (async () => {
              setLocalError('');
              try { await client().unblockContact(userId); } catch (cause) { setLocalError(errorText(cause)); }
            })()} />
          </View>;
        })}
        {!!localError && <Text accessibilityRole="alert" style={styles.error}>{localError}</Text>}
      </View></View>
      <Text style={styles.sectionTitle}>{t('ACCOUNT')}</Text>
      <View style={styles.section}><View style={styles.content}>
        {!retired && <EmailBinding />}
        {!retired && <><Text style={styles.body}>{t('Deleting the account removes the profile and push consents on the server, plus the device key, contacts and history on this phone. This cannot be undone.')}</Text>
        <Button danger title={deleting ? t('Deleting…') : t('Delete account')} busy={deleting} onPress={() => Alert.alert(
          t('Delete account?'),
          t('The profile, key, contacts and history will be deleted. This action is irreversible.'),
          [{ text: t('Cancel'), style: 'cancel' }, { text: t('Delete'), style: 'destructive', onPress: () => {
            if (deleting) return;
            setDeleting(true); setLocalError('');
            void deleteAccount().catch(cause => setLocalError(errorText(cause))).finally(() => setDeleting(false));
          } }],
        )} /></>}
        {!!localError && <Text accessibilityRole="alert" style={styles.error}>{localError}</Text>}
      </View></View>
      <Text style={styles.sectionTitle}>{t('ABOUT')}</Text>
      <View style={[styles.section, { marginTop: 0, padding: 18, gap: 13 }]}><Text style={styles.rowName}>LastCall · {Constants.expoConfig?.version}</Text>
        <Text style={styles.body}>{t('The server stores your profile and helps find contacts. Text, files and calls travel over a protected connection between participants; WebRTC uses TURN when needed.')}</Text>
        <Text style={styles.body}>{t('Contacts, messages and files are encrypted on the device. The outbox waits for the recipient for up to 7 days and survives restarts. In groups, data syncs between participants. Limits: 5 MiB per file, 16 retained files / 40 MiB total. On a network change the app tries to preserve the session for 10 seconds.')}</Text>
        <Text style={styles.body}>{t('Android notifications work only when Firebase is configured in the build and on the server and you granted permission. Text delivery requires the sender to be reachable. After a force-stop, Android push does not work until the app is opened manually. Android system incoming calls use LastCall’s own phone account, registered automatically. iOS push/CallKit and group calls are not available yet.')}</Text>
        <Text style={styles.info}>{t('A direct connection reveals your IP to the peer. This preview has not passed an independent audit, does not use Double Ratchet and does not promise DPI invisibility. Removing the app can lose the key and local history.')}</Text>
      </View>
      <View style={styles.section}><Pressable style={styles.listRow} accessibilityRole="link" onPress={() => void Linking.openURL('https://p2p.lienad.ru/privacy.html').catch(() => setLocalError(t('Could not open the privacy policy.')))}><Icon name="document-text-outline" /><Text style={[styles.rowName, styles.flex]}>{t('Privacy policy')}</Text><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable></View>
      <View style={styles.section}><Pressable style={styles.listRow} accessibilityRole="link" onPress={() => void Linking.openURL('https://p2p.lienad.ru/community.html').catch(() => setLocalError(t('Could not open community guidelines.')))}><Icon name="people-outline" /><Text style={[styles.rowName, styles.flex]}>{t('Community guidelines')}</Text><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable></View>
      <View style={styles.section}><Pressable style={styles.listRow} accessibilityRole="button" onPress={() => setShowDiagnostics(!showDiagnostics)}><Icon name="pulse-outline" /><Text style={[styles.rowName, styles.flex]}>{t('Diagnostics')}</Text><Icon name={showDiagnostics ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.secondary} /></Pressable>
        {showDiagnostics && <View style={styles.content}><Text selectable style={styles.info}>{t('Profile key: {key}', { key: identity?.userId ?? '' })}</Text>
          {snapshot.conversations.filter(item => item.kind === 'direct').map(item => <View key={item.id} style={{ gap: 5 }}><Text style={styles.rowName}>{item.title}</Text><Text style={styles.info}>{t('Connection: {status} · {route}', { status: item.session?.status ?? t('not established'), route: routeLabel(item) })}</Text>{formatMediaDiagnostics(item.session?.stats).map(line => <Text key={line} style={styles.info}>{line}</Text>)}</View>)}
          <Text style={styles.info}>{t('“—” means WebRTC has not provided the metric yet. Separate conversations use independent connections.')}</Text>
          <Button title={t('Copy connection report')} secondary onPress={() => void copyDiagnostics()} />
          {reportCopied && <Text style={styles.info}>{t('Report copied. Known names, messages, phone numbers and identifiers are hidden. Review the text before sending.')}</Text>}
        </View>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
