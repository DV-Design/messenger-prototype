import { Alert, Modal, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '../i18n';
import { messageActions, type MessageAction } from '../message-actions-model';
import type { ReactionEmoji } from '@messenger/core';
import { nextReaction } from '../reaction-model';
import { ReactionPicker } from './Reactions';
import { MenuRow, type IconName } from './ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface MessageTarget { id: string; type: 'message' | 'file'; author: string; own: boolean; expired: boolean; text?: string; reaction?: ReactionEmoji }

const LABELS: Record<MessageAction, string> = { edit: 'Edit', copy: 'Copy', deleteForEveryone: 'Delete for everyone', deleteForMe: 'Delete for me' };
const ICONS: Record<MessageAction, IconName> = { edit: 'create-outline', copy: 'copy-outline', deleteForEveryone: 'trash-outline', deleteForMe: 'trash-bin-outline' };

export function MessageActions({ target, onClose, onEdit, onDelete, onReact, onError }: { target?: MessageTarget; onClose: () => void; onEdit: (target: MessageTarget) => void; onReact?: (target: MessageTarget, emoji: ReactionEmoji | undefined) => void; onDelete: (target: MessageTarget, scope: 'me' | 'everyone') => void; onError: (message: string) => void }) {
  const insets = useSafeAreaInsets();
  function run(action: MessageAction) {
    if (!target) return;
    onClose();
    if (action === 'edit') onEdit(target);
    else if (action === 'copy') void Clipboard.setStringAsync(target.text ?? '').catch(() => onError(t('Could not copy the text.')));
    else if (action === 'deleteForEveryone') Alert.alert(t('Delete message for everyone?'), t('The other person\'s app removes it when both devices are online within 7 days. An older or modified app can keep it.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => onDelete(target, 'everyone') },
    ]);
    else Alert.alert(t('Delete message for you?'), t('It is removed from this phone only. Other people keep their copy.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => onDelete(target, 'me') },
    ]);
  }
  return <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12, 24, 30, 0.45)' }} />
      <View style={{ alignSelf: 'center', width: '100%', maxWidth: 520, backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 14, paddingBottom: 8 + insets.bottom, gap: 6 }}>
        {target && onReact && <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}><ReactionPicker current={target.reaction} onChoose={emoji => { onClose(); onReact(target, nextReaction(target.reaction, emoji)); }} /></View>}
        {target && messageActions(target).map(action => <MenuRow key={action} icon={ICONS[action]} title={t(LABELS[action])} danger={action === 'deleteForEveryone' || action === 'deleteForMe'} onPress={() => run(action)} />)}
      </View>
    </View>
  </Modal>;
}
