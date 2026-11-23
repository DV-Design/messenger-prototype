import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Redirect, router } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from '../components/SafeArea';
import { Avatar, Empty, Icon, IconButton, fileSize } from '../components/ui';
import { client, errorText, useMessenger } from '../runtime';
import { sendSharedFile } from '../attachments';
import { onPendingShare, pendingShare, setPendingShare } from '../share-intent';
import { shareTargets, splitText } from '../share-intent-model';
import { colors, styles } from '../styles';
import { t } from '../i18n';

/** "Send to…": pick a chat for what another app shared. Nothing is sent until a chat is tapped. */
export default function ShareScreen() {
  const { profile, snapshot } = useMessenger();
  const item = useSyncExternalStore(onPendingShare, pendingShare);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  // Leaving with Back without picking a chat drops the share and its copies; a send in progress keeps them.
  const sending = useRef(false);
  useEffect(() => () => { if (!sending.current) setPendingShare(null); }, []);
  if (!profile) return <Redirect href="/onboarding" />;
  if (!item) return <Redirect href="/" />;
  const shared = item;
  const targets = shareTargets(snapshot.conversations, query);
  const summary = !shared.text && !shared.files.length ? t('Nothing to send') : shared.files.length
    ? (shared.files.length === 1 ? shared.files[0]!.name : t('Files: {count}', { count: shared.files.length })) + (shared.text ? ' · ' + t('and text') : '')
    : shared.text!;
  async function send(conversationId: string) {
    setBusy(conversationId); setError(''); sending.current = true;
    const current = client();
    try {
      if (shared.text) for (const part of splitText(shared.text)) await current.sendText(conversationId, part);
      for (const file of shared.files) await sendSharedFile(current, conversationId, file);
      setPendingShare(null, true);
      router.replace({ pathname: '/chat/[id]', params: { id: conversationId } });
    } catch (cause) { setError(errorText(cause)); setBusy(undefined); sending.current = false; }
  }
  return <SafeAreaView style={styles.whiteScreen}>
    <View style={styles.header}><IconButton name="close" label={t('Cancel')} onPress={() => { setPendingShare(null); router.back(); }} /><View style={styles.flex}><Text style={[styles.title, { fontSize: 24 }]}>{t('Send to…')}</Text></View></View>
    <View style={styles.content}>
      <View style={[styles.row, { gap: 10, marginBottom: 10 }]}>
        <Icon name={shared.files.length ? 'document-attach-outline' : 'chatbox-ellipses-outline'} size={22} />
        <View style={styles.flex}><Text numberOfLines={3} style={styles.rowText}>{summary}</Text>
          {shared.files.length > 0 && shared.files.every(file => file.size !== null) && <Text style={styles.fileMeta}>{fileSize(shared.files.reduce((total, file) => total + (file.size ?? 0), 0))}</Text>}</View>
      </View>
      <TextInput value={query} onChangeText={setQuery} style={styles.input} placeholder={t('Search chats')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Search chats')} />
      {!!shared.failed && <Text style={[styles.rowText, { color: colors.danger, marginTop: 8 }]}>{t('Could not read files: {count}. The app you shared from did not allow it.', { count: shared.failed })}</Text>}
      {!!error && <Text style={[styles.rowText, { color: colors.danger, marginTop: 8 }]}>{error}</Text>}
    </View>
    <FlatList data={targets} keyExtractor={conversation => conversation.id} ItemSeparatorComponent={() => <View style={styles.separator} />} keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<Empty icon="chatbubbles-outline" title={t('No chats yet')} text={t('Find friends in the Contacts tab first.')} />}
      renderItem={({ item: conversation }) => {
        const peer = conversation.kind === 'direct' ? snapshot.contacts.find(contact => conversation.memberIds.includes(contact.userId)) : undefined;
        return <Pressable accessibilityRole="button" accessibilityLabel={t('Send to {name}', { name: conversation.title })} disabled={!!busy || (!shared.text && !shared.files.length)} onPress={() => void send(conversation.id)} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#EEF3F1' }]}>
          <Avatar name={conversation.title} id={peer?.userId ?? conversation.id} online={peer?.online} group={conversation.kind === 'group'} />
          <View style={styles.rowBody}><Text style={styles.rowName}>{conversation.title}</Text>{peer && <Text style={styles.rowText}>@{peer.username}</Text>}</View>
          {busy === conversation.id && <Text style={styles.fileMeta}>{t('Sending')}</Text>}
        </Pressable>;
      }} />
  </SafeAreaView>;
}
