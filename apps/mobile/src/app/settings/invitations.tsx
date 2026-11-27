import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Share, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { fetchRegistrationPolicyInfo, InviteRequestError, usernameSchema, type CreatedInvite, type InviteStatus, type MessengerClient } from '@messenger/core';
import { ActionLink, SettingsPage } from '../../components/ui';
import { intlLocale, t } from '../../i18n';
import { client, decideAccessRequest, listAccessRequests, useMessenger } from '../../runtime';
import type { AccessRequest } from '@messenger/core';
import { colors, styles } from '../../styles';

function failure(error: unknown): string {
  if (error instanceof InviteRequestError) {
    switch (error.code) {
      case 'invite-limit': return t('The daily invitation limit has been reached.');
      case 'invite-grants-limit': return t('The limit on accounts that can invite has been reached.');
      case 'invite-not-allowed': return t('You do not have permission to create invitations.');
      case 'invite-user-not-found': return t('No account has this username.');
      case 'invite-invalid': return t('This invitation is no longer active.');
    }
  }
  return t('Could not update invitations. Try again.');
}

function dateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(intlLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Invitations() {
  const { identity, profile, snapshot, retired } = useMessenger();
  return <SettingsPage title={t('Invitations')}>
    {identity && profile && !retired && <InvitationControls key={`${profile.serverUrl}:${identity.userId}`} serverUrl={profile.serverUrl} online={snapshot.status === 'online'} />}
    {identity && profile && !retired && snapshot.status === 'online' && <AccessRequestsPanel />}
  </SettingsPage>;
}

/** Administrators only: people without Telegram asking for access. Anyone else sees nothing here. */
function AccessRequestsPanel() {
  const [requests, setRequests] = useState<AccessRequest[]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const load = useCallback(() => listAccessRequests().then(setRequests, () => setRequests(undefined)), []);
  useEffect(() => { void load(); }, [load]);
  if (!requests) return null;
  async function decide(id: string, approve: boolean) {
    setBusy(id); setError('');
    try { await decideAccessRequest(id, approve); await load(); }
    catch { setError(t('Could not answer the request. Try again.')); }
    finally { setBusy(undefined); }
  }
  return <>
    <Text style={styles.sectionTitle}>{t('REQUESTS')}</Text>
    <View style={[styles.section, styles.content, { marginTop: 0, gap: 14 }]}>
      {requests.length === 0 && <Text style={styles.info}>{t('No requests waiting.')}</Text>}
      {requests.map(request => <View key={request.id} style={{ gap: 4 }}>
        <Text style={[styles.body, { fontWeight: '700' }]}>{request.name}</Text>
        {!!request.contact && <Text selectable style={styles.info}>{request.contact}</Text>}
        <Text selectable style={styles.body}>{request.message}</Text>
        <Text style={styles.info}>{dateTime(request.createdAt)}</Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <ActionLink icon="checkmark-circle-outline" busy={busy === request.id} title={t('Approve')} onPress={() => void decide(request.id, true)} />
          <ActionLink icon="close-circle-outline" danger disabled={busy === request.id} title={t('Decline')} onPress={() => void decide(request.id, false)} />
        </View>
      </View>)}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Text style={styles.info}>{t('Approving sends an invitation code to the app that asked; the person then signs up with email.')}</Text>
    </View>
  </>;
}

function InvitationControls({ serverUrl, online }: { serverUrl: string; online: boolean }) {
  const [supported, setSupported] = useState<boolean>();
  const [status, setStatus] = useState<InviteStatus>();
  const [issued, setIssued] = useState<CreatedInvite>();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const changing = useRef(false);
  const target = username.trim().replace(/^@/, '').toLowerCase();

  const refresh = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!online) return;
    const attempt = ++request.current;
    try {
      const manager = client();
      const { supportsInvites } = await fetchRegistrationPolicyInfo(serverUrl);
      if (!isCurrent() || attempt !== request.current) return;
      if (!supportsInvites) {
        setSupported(false);
        setStatus(undefined);
        setIssued(undefined);
        setError('');
        return;
      }
      const next = await manager.getInviteStatus();
      if (!isCurrent() || attempt !== request.current) return;
      setSupported(true);
      setStatus(next);
      setIssued(current => current && next.active.some(invite => invite.id === current.id) ? current : undefined);
      setError('');
    } catch (cause) {
      if (isCurrent() && attempt === request.current) setError(failure(cause));
    }
  }, [online, serverUrl]);

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => current ? refresh(() => current) : undefined);
    return () => { current = false; };
  }, [refresh]);
  const resetAt = status?.resetAt;
  useEffect(() => {
    if (!online || !resetAt || resetAt <= Date.now()) return;
    const timer = setTimeout(() => void refresh(), resetAt - Date.now() + 100);
    return () => clearTimeout(timer);
  }, [online, refresh, resetAt]);

  async function change(work: (manager: MessengerClient) => Promise<void>) {
    if (!online || changing.current) return;
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      await work(client());
      await refresh();
    } catch (cause) {
      await refresh();
      setError(failure(cause));
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  const create = () => void change(async manager => {
    setIssued(await manager.createInvite());
    setCopied(false);
  });
  const deny = (name: string) => Alert.alert(t('Remove invitation permission?'), t('Unused invitations from @{name} will stop working.', { name }), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Remove'), style: 'destructive', onPress: () => void change(manager => manager.grantInvites(name, false)) },
  ]);

  return <>
    <View style={[styles.section, styles.content, { gap: 10 }]}>
      {!online ? <Text style={styles.body}>{t('Connect to the server to manage invitations.')}</Text>
        : supported === false ? <Text style={styles.body}>{t('This server does not support invitations.')}</Text>
        : !status && !error ? <Text style={styles.body}>{t('Checking invitation permissions…')}</Text>
        : status && !status.canInvite && !status.isAdmin ? <Text style={styles.body}>{t('Your account cannot issue invitations.')}</Text> : null}
      {online && !!error && <>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <ActionLink icon="refresh" title={t('Refresh')} disabled={busy} onPress={() => void refresh()} />
      </>}
      {online && status?.canInvite && <>
        <Text style={styles.body}>{t('Invitations left today: {remaining} of 5', { remaining: status.remaining })}</Text>
        <Text style={styles.info}>{t('Limit resets at {time}', { time: dateTime(status.resetAt) })}</Text>
        <ActionLink icon="person-add-outline" title={t('Create invitation')} busy={busy} disabled={status.remaining === 0} onPress={create} />
        {issued && <>
          <Text style={styles.info}>{t('Send this single-use code to the person you are inviting.')}</Text>
          <Text selectable style={styles.body}>{issued.code}</Text>
          <ActionLink icon="copy-outline" title={copied ? t('Invitation code copied') : t('Copy invitation code')} onPress={() => {
            void Clipboard.setStringAsync(issued.code).then(ok => {
              if (!ok) throw new Error('Clipboard unavailable');
              setCopied(true);
            }).catch(() => setError(t('Could not copy the invitation code.')));
          }} />
          <ActionLink icon="share-outline" title={t('Share invitation')} onPress={() => {
            // Message text, never a link: the code must not end up in URLs, previews or server logs.
            void Share.share({ message: t('LastCall invitation. Install LastCall, choose Register and paste this whole message or the code:\n{code}\nThe code works once and expires in 7 days.', { code: issued.code }) })
              .catch(() => setError(t('Could not open the share menu.')));
          }} />
        </>}
        {status.active.map(invite => <View key={invite.id}>
          <Text style={styles.body}>{t('Invitation {id}', { id: invite.id.slice(-6) })}</Text>
          <Text style={styles.info}>{t('Expires at {time}', { time: dateTime(invite.expiresAt) })}</Text>
          <ActionLink icon="close-circle-outline" title={t('Revoke invitation')} danger disabled={busy} onPress={() => void change(manager => manager.revokeInvite(invite.id))} />
        </View>)}
      </>}
    </View>
    {online && status?.isAdmin && <>
      <Text style={styles.sectionTitle}>{t('INVITATION PERMISSIONS')}</Text>
      <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
        <Text style={styles.info}>{t('Choose an existing account by its exact @username.')}</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} editable={!busy} maxLength={25} autoCapitalize="none" autoCorrect={false} placeholder="@username" placeholderTextColor={colors.secondary} accessibilityLabel={t('Username')} />
        <ActionLink icon="checkmark-circle-outline" title={t('Allow invitations')} disabled={busy || !usernameSchema.safeParse(target).success || status.granted.includes(target)} onPress={() => void change(async manager => {
          await manager.grantInvites(target, true);
          setUsername('');
        })} />
        {status.granted.map(name => <View key={name}>
          <Text style={styles.body}>@{name}</Text>
          <ActionLink icon="remove-circle-outline" title={t('Remove permission for @{name}', { name })} danger disabled={busy} onPress={() => deny(name)} />
        </View>)}
      </View>
    </>}
  </>;
}
