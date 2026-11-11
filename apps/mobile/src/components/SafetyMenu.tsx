import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { Button, MenuRow } from './ui';

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
  const insets = useSafeAreaInsets();

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
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={close} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12, 24, 30, 0.45)' }} />
      <View style={{ alignSelf: 'center', width: '100%', maxWidth: 520, maxHeight: '86%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 18, paddingBottom: 14 + insets.bottom, gap: 10 }}>
        <Text numberOfLines={1} style={[styles.chatName, { paddingHorizontal: 20 }]}>{reporting ? t('Report {title}', { title }) : title}</Text>
        {reporting ? <View style={{ paddingHorizontal: 20, gap: 12 }}>
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
            <MenuRow icon="arrow-back" title={t('Back')} onPress={() => { setReporting(false); setError(''); }} />
          </>}
        </View> : <>
          <ScrollView>
            {peer && onSafetyCode && <MenuRow icon="shield-checkmark-outline" title={t('Safety code')} onPress={() => { close(); onSafetyCode(); }} />}
            {group ? members.map(member => <MenuRow key={member.userId} icon={blockedSet.has(member.userId) ? 'lock-open-outline' : 'ban-outline'} busy={busy} danger={!blockedSet.has(member.userId)}
              title={blockedSet.has(member.userId) ? t('Unblock {name}', { name: member.displayName }) : t('Block {name}', { name: member.displayName })}
              onPress={() => void change(() => blockedSet.has(member.userId) ? onUnblock(member.userId) : onBlock(member.userId), false)} />)
              : peer && <MenuRow icon={blockedSet.has(peer.userId) ? 'lock-open-outline' : 'ban-outline'} busy={busy} danger={!blockedSet.has(peer.userId)}
                title={blockedSet.has(peer.userId) ? t('Unblock {name}', { name: peer.displayName }) : t('Block {name}', { name: peer.displayName })}
                subtitle={blockedSet.has(peer.userId) ? undefined : t('Block this contact to hide messages and calls.')}
                onPress={() => void change(() => blockedSet.has(peer.userId) ? onUnblock(peer.userId) : onBlock(peer.userId), true)} />}
            <MenuRow icon="flag-outline" title={t('Report {title}', { title })} onPress={() => { setReporting(true); setError(''); }} />
            <MenuRow icon="book-outline" accessibilityRole="link" title={t('Community guidelines')} onPress={() => { void Linking.openURL(COMMUNITY_URL).catch(() => setError(t('Could not open community guidelines.'))); }} />
            {onDeleteChat && <MenuRow icon="trash-outline" danger title={t('Delete chat')} onPress={() => { close(); onDeleteChat(); }} />}
            {onDeleteContact && <MenuRow icon="person-remove-outline" danger title={t('Delete contact')} onPress={() => { close(); onDeleteContact(); }} />}
          </ScrollView>
          {!!error && <Text style={[styles.error, { marginHorizontal: 16 }]}>{error}</Text>}
        </>}
      </View>
    </View>
  </Modal>;
}
