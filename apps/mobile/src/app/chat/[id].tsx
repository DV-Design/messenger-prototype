import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Redirect, router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MessengerMessage } from '@messenger/core';
import { pickDocument, pickMedia, shareFile } from '../../attachments';
import { AttachmentCard } from '../../components/AttachmentCard';
import { Avatar, Empty, Icon, IconButton, lastSeen, time } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { transportNotice } from '../../transport-notice';
import { deliveryLabel, waitingForDelivery } from '../../delivery-model';

export default function Chat() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { snapshot, identity, profile } = useMessenger();
  const conversation = snapshot.conversations.find(item => item.id === id);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<ComponentRef<typeof FlatList<MessengerMessage>>>(null);
  const unread = conversation?.unread ?? 0;
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && id && unread) client().markRead(id);
  }, [focused, id, unread]);
  if (!profile) return <Redirect href="/onboarding" />;
  if (!conversation) return <SafeAreaView style={styles.whiteScreen}><View style={styles.chatHeader}><IconButton name="chevron-back" label="Назад" onPress={() => router.back()} /></View><Empty icon="chatbubble-outline" title="Чат не найден" text="Он может относиться к другому серверу. Вернитесь к списку чатов." /></SafeAreaView>;
  const peer = snapshot.contacts.find(item => conversation.memberIds.includes(item.userId) && item.userId !== identity?.userId);
  const group = conversation.kind === 'group';
  const canCall = !group && !snapshot.activeCall && (snapshot.status === 'online' || conversation.session?.status === 'connected');
  const notice = transportNotice({ directory: snapshot.status, group, peerOnline: peer?.online, session: conversation.session,
    pending: conversation.messages.filter(item => item.from === identity?.userId && waitingForDelivery(item)).length
      + conversation.files.filter(item => item.senderId === identity?.userId && waitingForDelivery(item)).length });
  async function action(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  function send() {
    const text = draft;
    void action(async () => { await client().sendText(conversation!.id, text); setDraft(''); });
  }
  function attach(kind: 'media' | 'document') {
    // The manager establishes recipient sessions on demand, including group
    // members without a separate DM. Chat-list rows are not transport state.
    setAttachments(false);
    void action(() => kind === 'media' ? pickMedia(conversation!.id) : pickDocument(conversation!.id));
  }
  function renderMessage(item: MessengerMessage) {
    const own = item.from === identity?.userId;
    const sender = snapshot.contacts.find(contact => contact.userId === item.from)?.displayName ?? 'Участник';
    const pending = waitingForDelivery(item);
    const delivered = item.status === 'delivered';
    const expired = item.status === 'expired';
    const label = deliveryLabel(item, group);
    return <View style={[styles.bubble, own && styles.bubbleSelf]}>
      {group && !own && <Text style={styles.senderName}>{sender}</Text>}<Text selectable style={styles.message}>{item.text}</Text>
      {own && (group || expired) && <Text style={[styles.fileMeta, expired && { color: '#A33535' }]}>{label}</Text>}
      <View style={styles.messageMeta}><Text style={styles.messageTime}>{time(item.timestamp)}</Text>{own && <View accessibilityLabel={label}><Icon name={expired ? 'alert-circle-outline' : pending ? 'time-outline' : delivered ? 'checkmark-done' : 'checkmark'} size={15} color={expired ? '#A33535' : delivered ? colors.accent : '#70877D'} /></View>}</View>
    </View>;
  }
  return <SafeAreaView style={styles.whiteScreen} edges={['top', 'bottom']}>
    <View style={styles.chatHeader}><IconButton name="chevron-back" label="Назад к чатам" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />
      <Avatar name={conversation.title} id={conversation.id} group={group} size={41} /><View style={[styles.flex, { marginLeft: 7 }]}><Text numberOfLines={1} style={styles.chatName}>{conversation.title}</Text><Text numberOfLines={1} style={[styles.chatStatus, !group && peer?.online && { color: colors.accent }]}>{group ? `${conversation.memberIds.length} участников` : lastSeen(!!peer?.online, peer?.lastSeen ?? 0)}</Text></View>
      <IconButton name="call-outline" label={group ? 'Групповые звонки недоступны' : 'Аудиозвонок'} disabled={!canCall || busy} onPress={() => void action(() => client().startCall(conversation.id, false))} />
      <IconButton name="videocam-outline" label={group ? 'Групповые видеозвонки недоступны' : 'Видеозвонок'} disabled={!canCall || busy} onPress={() => void action(() => client().startCall(conversation.id, true))} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Состояние доставки. Открыть настройки соединения" onPress={() => router.push('/(tabs)/settings')} style={{ paddingHorizontal: 15, paddingVertical: 9, backgroundColor: notice.warning ? '#FFF2D8' : '#EDF5F1' }}><Text style={[styles.info, { color: notice.warning ? '#7B5924' : '#4E7161' }]}>{notice.text}</Text></Pressable>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.conversation}>
        {group && <Text style={[styles.info, { textAlign: 'center', paddingVertical: 8, paddingHorizontal: 15 }]}>Группа до 8 участников · звонки в группах пока недоступны</Text>}
        <FlatList ref={list} data={conversation.messages} keyExtractor={item => item.id + item.from} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => renderMessage(item)}
          ListEmptyComponent={conversation.files.length === 0 ? <Empty icon="chatbubble-ellipses-outline" title="Начните разговор" text={group ? 'Данные синхронизируются между телефонами участников.' : 'Отправьте первое сообщение. Если друга нет в сети, оно подождёт на вашем устройстве до 7 дней.'} /> : undefined}
          ListFooterComponent={<>{conversation.files.map(file => <View key={`${file.id}-${file.senderId}`} style={{ marginTop: 9 }}><AttachmentCard file={file} self={file.senderId === identity?.userId} group={group} sender={group ? snapshot.contacts.find(contact => contact.userId === file.senderId)?.displayName : undefined} onOpen={() => void action(() => shareFile(file))} /></View>)}</>} />
      </View>
      {!!error && <Pressable accessibilityRole="button" accessibilityLabel="Скрыть ошибку" onPress={() => setError('')}><Text style={[styles.error, { borderRadius: 0 }]}>{error}</Text></Pressable>}
      {attachments && <View><View style={styles.attachmentMenu}>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('media')}><Icon name="images-outline" size={27} /><Text style={styles.rowText}>Фото и видео</Text></Pressable>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('document')}><Icon name="document-outline" size={27} /><Text style={styles.rowText}>Файл до 5 МиБ</Text></Pressable>
      </View></View>}
      <View style={styles.composer}><IconButton name={attachments ? 'close' : 'attach'} label="Прикрепить файл" disabled={busy} onPress={() => setAttachments(!attachments)} />
        <TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} multiline maxLength={4000} placeholder="Сообщение" placeholderTextColor={colors.secondary} accessibilityLabel="Текст сообщения" />
        <Pressable style={[styles.send, (!draft.trim() || busy) && styles.disabled]} accessibilityRole="button" accessibilityLabel="Отправить сообщение" disabled={!draft.trim() || busy} onPress={send}><Icon name="arrow-up" color={colors.white} size={25} /></Pressable>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
