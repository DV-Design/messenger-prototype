import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { Button } from './ui';

const COMMUNITY_URL = 'https://p2p.lienad.ru/community.html';
const REASONS = [
  { code: 'spam', label: 'Spam' },
  { code: 'harassment', label: 'Harassment or threats' },
  { code: 'illegal', label: 'Illegal content' },
  { code: 'other', label: 'Other' },
] as const;
type ReportReason = typeof REASONS[number]['code'];

export interface SafetyMember { userId: string; displayName: string }

/**
 * In-app blocking and reporting required by the Google Play UGC policy.
 * Reports are sent through the authenticated directory with report metadata
 * and optional details; message content is never attached automatically.
 */
export function SafetyMenu({ visible, group, title, targetId, peer, members, blocked, onClose, onBlock, onUnblock, onSafetyCode, onReport, onDeleteChat, onDeleteContact }: {
  visible: boolean;
  group: boolean;
  title: string;
  targetId: string;
  peer?: SafetyMember;
  members: SafetyMember[];
  blocked: string[];
  onClose: () => void;
  onBlock: (userId: string) => Promise<void>;
  onUnblock: (userId: string) => Promise<void>;
  onSafetyCode?: () => void;
  onReport: (input: { reason: ReportReason; details: string }) => Promise<void>;
  onDeleteChat?: () => void;
  onDeleteContact?: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState<ReportReason>(REASONS[0].code);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blockedSet = new Set(blocked);

  function close() {
    setReporting(false); setReported(false); setDetails(''); setError(''); setBusy(false); onClose();
  }
  async function change(action: () => Promise<void>, closeAfter: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); if (closeAfter) close(); }
    catch { setError(t('Could not change the block. Try again.')); }
    finally { setBusy(false); }
  }
  async function sendReport() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await onReport({ reason, details: details.trim() });
      setReported(true);
    } catch {
      setError(t('Could not send the report. Try again.'));
    } finally { setBusy(false); }
  }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={close} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12, 24, 30, 0.45)' }} />
      <View style={{ alignSelf: 'center', width: '100%', maxWidth: 430, maxHeight: '86%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, gap: 12 }}>
        <Text style={styles.title}>{reporting ? t('Report {title}', { title }) : t('Safety options')}</Text>
        {reporting ? <>
          {reported ? <>
            <Text style={styles.body}>{t('Report sent. We will review it.')}</Text>
            <Button title={t('Close')} onPress={close} />
          </> : <>
            <Text style={styles.info}>{t('Choose a reason. Only report metadata and your optional details are sent; message content is not attached.')}</Text>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {REASONS.map(option => <Pressable key={option.code} accessibilityRole="radio" accessibilityState={{ selected: reason === option.code }} onPress={() => setReason(option.code)}
                style={({ pressed }) => [{ borderWidth: 1, borderColor: reason === option.code ? colors.accent : '#D7E1E6', backgroundColor: reason === option.code ? '#EDF5F1' : '#FFFFFF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }, pressed && styles.pressed]}>
                <Text style={styles.rowText}>{t(option.label)}</Text>
              </Pressable>)}
            </ScrollView>
            <TextInput value={details} onChangeText={setDetails} maxLength={500} multiline placeholder={t('Details (optional)')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Report details')}
              style={{ minHeight: 70, borderWidth: 1, borderColor: '#D7E1E6', borderRadius: 12, padding: 10, color: colors.text, textAlignVertical: 'top' }} />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button title={t('Send report')} busy={busy} onPress={() => void sendReport()} />
            <Button title={t('Back')} secondary onPress={() => { setReporting(false); setError(''); }} />
          </>}
        </> : <>
          <Text style={styles.info}>{group ? t('Block a member to hide their messages and calls.') : t('Block this contact to hide messages and calls.')}</Text>
          {group ? <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 8 }}>
            {members.map(member => <View key={member.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text numberOfLines={1} style={[styles.rowText, styles.flex]}>{member.displayName}</Text>
              <Button title={blockedSet.has(member.userId) ? t('Unblock') : t('Block')} secondary={blockedSet.has(member.userId)} danger={!blockedSet.has(member.userId)} busy={busy}
                onPress={() => void change(() => blockedSet.has(member.userId) ? onUnblock(member.userId) : onBlock(member.userId), false)} />
            </View>)}
          </ScrollView> : peer && <Button title={blockedSet.has(peer.userId) ? t('Unblock {name}', { name: peer.displayName }) : t('Block {name}', { name: peer.displayName })}
            secondary={blockedSet.has(peer.userId)} danger={!blockedSet.has(peer.userId)} busy={busy}
            onPress={() => void change(() => blockedSet.has(peer.userId) ? onUnblock(peer.userId) : onBlock(peer.userId), true)} />}
          {!!error && <Text style={styles.error}>{error}</Text>}
          {peer && onSafetyCode && <Button title={t('Safety code')} secondary onPress={() => { close(); onSafetyCode(); }} />}
          <Button title={t('Report {title}', { title })} secondary onPress={() => { setReporting(true); setError(''); }} />
          <Button title={t('Community guidelines')} secondary onPress={() => { void Linking.openURL(COMMUNITY_URL).catch(() => setError(t('Could not open community guidelines.'))); }} />
          {onDeleteChat && <Button title={t('Delete chat')} danger onPress={() => { close(); onDeleteChat(); }} />}
          {onDeleteContact && <Button title={t('Delete contact')} danger onPress={() => { close(); onDeleteContact(); }} />}
          <Button title={t('Close')} secondary onPress={close} />
        </>}
      </View>
    </View>
  </Modal>;
}
