import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Empty, Icon, IconButton } from '../components/ui';
import { client, errorText, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
export default function NewGroup() {
  const { profile, snapshot } = useMessenger();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!profile) return <Redirect href="/onboarding" />;
  async function create() {
    setBusy(true); setError('');
    try { const id = await client().createGroup(title.trim(), selected); router.replace({ pathname: '/chat/[id]', params: { id } }); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.whiteScreen}>
    <View style={styles.header}><IconButton name="close" label="Закрыть" onPress={() => router.back()} /><View style={styles.flex}><Text style={[styles.title, { fontSize: 24 }]}>Новая группа</Text><Text style={styles.subtitle}>{selected.length + 1} из 8 участников, включая вас</Text></View></View>
    <View style={styles.content}><TextInput value={title} onChangeText={setTitle} maxLength={64} style={styles.input} placeholder="Название группы" placeholderTextColor={colors.secondary} accessibilityLabel="Название группы" /><Text style={styles.info}>Выберите до 7 контактов. Текст передаётся каждому участнику напрямую. Групповые звонки пока недоступны.</Text>{!!error && <Text style={styles.error}>{error}</Text>}</View>
    <FlatList data={snapshot.contacts} keyExtractor={item => item.userId} ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={<Empty icon="people-outline" title="Пока нет контактов" text="Сначала найдите друзей во вкладке «Контакты», затем создайте группу." />}
      renderItem={({ item }) => { const checked = selected.includes(item.userId); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} disabled={busy || (!checked && selected.length >= 7)} style={styles.listRow} onPress={() => setSelected(value => checked ? value.filter(id => id !== item.userId) : [...value, item.userId])}>
        <Avatar name={item.displayName} id={item.userId} online={item.online} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={styles.rowText}>@{item.username}</Text></View><View style={[styles.selectionCircle, checked && styles.selectionActive]}>{checked && <Icon name="checkmark" size={17} color={colors.white} />}</View>
      </Pressable>; }} />
    <View style={styles.content}><Button title="Создать группу" busy={busy} disabled={!title.trim() || selected.length === 0 || snapshot.status !== 'online'} onPress={() => void create()} /></View>
  </SafeAreaView>;
}
