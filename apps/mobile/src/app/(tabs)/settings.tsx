import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Avatar, Button, Icon, ScreenHeader, connectionLabel } from '../../components/ui';
import { changeServer, errorText, reconnect, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
const metric = (value: number | undefined, suffix: string) => value === undefined ? '—' : `${value.toFixed(1)} ${suffix}`;
export default function Settings() {
  const { profile, identity, snapshot, error, busy } = useMessenger();
  const [showServer, setShowServer] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [server, setServer] = useState(profile?.serverUrl ?? '');
  const [localError, setLocalError] = useState('');
  const [copied, setCopied] = useState(false);
  async function save() {
    setLocalError('');
    try { await changeServer(server); } catch (cause) { setLocalError(errorText(cause)); }
  }
  return <SafeAreaView style={styles.screen} edges={['top']}><ScreenHeader title="Настройки" />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 35 }}>
      <View style={styles.profile}><Avatar name={profile?.displayName ?? ''} id={identity?.userId} size={86} /><Text style={styles.profileName}>{profile?.displayName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Скопировать имя пользователя" onPress={() => { void Clipboard.setStringAsync(`@${profile?.username ?? ''}`).then(() => setCopied(true)).catch(cause => setLocalError(errorText(cause))); }}><Text style={styles.profileUsername}>@{profile?.username}</Text></Pressable>{copied && <Text style={styles.info}>Имя пользователя скопировано</Text>}
      </View>
      <Text style={styles.sectionTitle}>ПОДКЛЮЧЕНИЕ</Text>
      <View style={[styles.section, { marginTop: 0 }]}>
        <View style={styles.listRow}><Icon name={snapshot.status === 'online' ? 'checkmark-circle' : 'cloud-offline-outline'} color={snapshot.status === 'online' ? colors.accent : colors.secondary} /><View style={styles.rowBody}><Text style={styles.rowName}>{connectionLabel[snapshot.status]}</Text><Text style={styles.rowText}>Статусы и поиск контактов</Text></View></View>
        <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => setShowServer(!showServer)}><Icon name="server-outline" /><View style={styles.rowBody}><Text style={styles.rowName}>Сервер</Text><Text numberOfLines={1} style={styles.rowText}>{profile?.serverUrl}</Text></View><Icon name={showServer ? 'chevron-up' : 'chevron-forward'} color={colors.secondary} size={18} /></Pressable>
        {showServer && <View style={styles.content}><TextInput style={styles.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Адрес сервера" placeholder="https://lienad.ru/messenger" /><Text style={styles.info}>Контакты и история хранятся отдельно для каждого сервера. Смена адреса переподключит приложение.</Text><Button title="Сохранить и подключиться" busy={busy} onPress={() => void save()} /></View>}
        {snapshot.status !== 'online' && <View style={{ padding: 16 }}><Button title="Переподключиться" secondary onPress={() => void reconnect()} disabled={snapshot.status === 'connecting'} /></View>}
      </View>
      {!!(localError || error || snapshot.error) && <Text style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{localError || error || snapshot.error}</Text>}
      <Text style={styles.sectionTitle}>О ПРИЛОЖЕНИИ</Text>
      <View style={[styles.section, { marginTop: 0, padding: 18, gap: 13 }]}><Text style={styles.rowName}>LastCall · 0.2.0</Text>
        <Text style={styles.body}>Сервер хранит профиль и помогает находить собеседников. Текст, файлы и звонки идут по защищённому соединению между участниками; при необходимости WebRTC использует TURN.</Text>
        <Text style={styles.body}>Контакты, группы и недавняя переписка зашифрованы на устройстве. Ожидающие сообщения отправятся, когда оба участника будут доступны. Файлы до 5 МиБ доступны в текущем запуске и требуют соединения со всеми получателями.</Text>
        <Text style={styles.body}>Нет фоновых push-уведомлений: iOS и Android могут приостанавливать приложение. Входящие звонки надёжнее принимать, пока приложение открыто. Голосовые заметки и групповые звонки пока недоступны.</Text>
        <Text style={styles.info}>Прямое соединение раскрывает IP собеседнику. Эта предварительная версия не прошла независимый аудит, не использует Double Ratchet и не обещает невидимость для DPI. При удалении приложения ключ и локальная история могут быть утрачены.</Text>
      </View>
      <View style={styles.section}><Pressable style={styles.listRow} accessibilityRole="button" onPress={() => setShowDiagnostics(!showDiagnostics)}><Icon name="pulse-outline" /><Text style={[styles.rowName, styles.flex]}>Диагностика</Text><Icon name={showDiagnostics ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.secondary} /></Pressable>
        {showDiagnostics && <View style={styles.content}><Text selectable style={styles.info}>Ключ профиля: {identity?.userId}</Text>
          {snapshot.conversations.filter(item => item.kind === 'direct').map(item => <View key={item.id} style={{ gap: 5 }}><Text style={styles.rowName}>{item.title}</Text><Text style={styles.info}>Соединение: {item.session?.status ?? 'не установлено'} · {item.session?.route === 'direct' ? 'P2P напрямую' : item.session?.route === 'relay' ? 'через TURN' : 'маршрут не определён'}</Text><Text style={styles.info}>RTT {metric(item.session?.stats.rttMs, 'мс')} · аудио {metric(item.session?.stats.audioBitrateKbps, 'кбит/с')} · jitter {metric(item.session?.stats.jitterMs, 'мс')} · потери {item.session?.stats.packetsLost ?? '—'}</Text></View>)}
          <Text style={styles.info}>«—» означает, что WebRTC ещё не предоставил метрику. Отдельные диалоги используют независимые соединения.</Text>
        </View>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
