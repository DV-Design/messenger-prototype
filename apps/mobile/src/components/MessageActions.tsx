import { Alert, Modal, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '../i18n';
import { messageActions, type MessageAction } from '../message-actions-model';
import { Button } from './ui';

export interface MessageTarget { id: string; type: 'message' | 'file'; author: string; own: boolean; expired: boolean; text?: string }

const LABELS: Record<MessageAction, string> = { edit: 'Edit', copy: 'Copy', deleteForEveryone: 'Delete for everyone', deleteForMe: 'Delete for me' };

export function MessageActions({ target, onClose, onEdit, onDelete, onError }: { target?: MessageTarget; onClose: () => void; onEdit: (target: MessageTarget) => void; onDelete: (target: MessageTarget, scope: 'me' | 'everyone') => void; onError: (message: string) => void }) {
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
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12, 24, 30, 0.45)' }} />
      <View style={{ alignSelf: 'center', width: '100%', maxWidth: 430, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, gap: 12 }}>
        {target && messageActions(target).map(action => <Button key={action} title={t(LABELS[action])} secondary={action === 'edit' || action === 'copy'} danger={action === 'deleteForEveryone' || action === 'deleteForMe'} onPress={() => run(action)} />)}
        <Button title={t('Close')} secondary onPress={onClose} />
      </View>
    </View>
  </Modal>;
}
