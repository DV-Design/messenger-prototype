import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Avatar, Button, Icon, ScreenHeader, connectionLabel } from '../../components/ui';
import { changeServer, errorText, reconnect, useMessenger } from '../../runtime';
import { sanitizeDiagnostic } from '../../diagnostics';
import { usePushStatus } from '../../components/PushBridge';
import { colors, styles } from '../../styles';
const metric = (value: number | undefined, suffix: string) => value === undefined ? '—' : `${value.toFixed(1)} ${suffix}`;
export default function Settings() {
  const { profile, identity, snapshot, error, busy } = useMessenger();
  const pushStatus = usePushStatus();
  const [showServer, setShowServer] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [server, setServer] = useState(profile?.serverUrl ?? '');
  const [localError, setLocalError] = useState('');
  const [copied, setCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  async function save() {
    setLocalError('');
    try { await changeServer(server); } catch (cause) { setLocalError(errorText(cause)); }
  }
  async function copyDiagnostics() {
    const privateValues = [profile?.displayName ?? '', profile?.username ?? '', identity?.userId ?? '', identity?.publicKey ?? '', identity?.privateKey ?? '',
      ...snapshot.contacts.flatMap(user => [user.displayName, user.username, user.userId, user.publicKey]),
      ...snapshot.conversations.flatMap(item => [item.title, ...item.messages.map(message => message.text)])];
    const sanitize = (value?: string) => sanitizeDiagnostic(value, privateValues);
    const peers = snapshot.conversations.filter(item => item.kind === 'direct');
    const report = ['LastCall 0.4.0', `Платформа: ${Platform.OS} ${Platform.Version}`, `Сервер: ${sanitize(profile?.serverUrl)}`, `Directory: ${snapshot.status}`, `Личных соединений: ${peers.length}`, `Ошибка приложения: ${sanitize(snapshot.error)}`,
      ...peers.map((item, index) => `Контакт ${index + 1}: ${item.session?.status ?? 'idle'} / ${item.session?.route ?? 'unknown'} / ${sanitize(item.session?.error)}`)].join('\n');
    try { await Clipboard.setStringAsync(report); setReportCopied(true); }
    catch (cause) { setLocalError(errorText(cause)); }
  }
  return <SafeAreaView style={styles.screen} edges={['top']}><ScreenHeader title="Настройки" />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 35 }}>
      <View style={styles.profile}><Avatar name={profile?.displayName ?? ''} id={identity?.userId} size={86} /><Text style={styles.profileName}>{profile?.displayName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Скопировать имя пользователя" onPress={() => { void Clipboard.setStringAsync(`@${profile?.username ?? ''}`).then(() => setCopied(true)).catch(cause => setLocalError(errorText(cause))); }}><Text style={styles.profileUsername}>@{profile?.username}</Text></Pressable>{copied && <Text style={styles.info}>Имя пользователя скопировано</Text>}
      <Text style={[styles.info, { marginTop: 12, textAlign: 'center' }]}>Логин подтверждён сервером и закреплён за ключом этого устройства.</Text></View>
      <Text style={styles.sectionTitle}>ДОСТУПЫ</Text>
      <View style={[styles.section, { marginTop: 0 }]}><Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/permissions')}><Icon name="shield-checkmark-outline" /><Text style={[styles.rowName, styles.flex]}>Доступы приложения</Text><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable></View>
      <Text style={styles.sectionTitle}>ПОДКЛЮЧЕНИЕ</Text>
      <View style={[styles.section, { marginTop: 0 }]}>
        <View style={styles.listRow}><Icon name={snapshot.status === 'online' ? 'checkmark-circle' : 'cloud-offline-outline'} color={snapshot.status === 'online' ? colors.accent : colors.secondary} /><View style={styles.rowBody}><Text style={styles.rowName}>{connectionLabel[snapshot.status]}</Text><Text style={styles.rowText}>Статусы и поиск контактов</Text></View></View>
        <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => setShowServer(!showServer)}><Icon name="server-outline" /><View style={styles.rowBody}><Text style={styles.rowName}>Сервер</Text><Text numberOfLines={1} style={styles.rowText}>{profile?.serverUrl}</Text></View><Icon name={showServer ? 'chevron-up' : 'chevron-forward'} color={colors.secondary} size={18} /></Pressable>
        {showServer && <View style={styles.content}><TextInput style={styles.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Адрес сервера" placeholder="https://lienad.ru/messenger" /><Text style={styles.info}>Контакты и история хранятся отдельно для каждого сервера. Смена адреса переподключит приложение.</Text><Button title="Сохранить и подключиться" busy={busy} onPress={() => void save()} /></View>}
        {snapshot.status !== 'online' && <View style={{ padding: 16 }}><Button title="Переподключиться" secondary onPress={() => void reconnect()} disabled={snapshot.status === 'connecting'} /></View>}
      </View>
      {!!(localError || error || snapshot.error) && <Text style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{localError || error || snapshot.error}</Text>}
      <Text style={styles.sectionTitle}>УВЕДОМЛЕНИЯ</Text><View style={[styles.section, styles.content]}><Text style={styles.body}>{pushStatus}</Text><Button title="Настроить доступы" secondary onPress={() => router.push('/permissions')} /></View>
      <Text style={styles.sectionTitle}>О ПРИЛОЖЕНИИ</Text>
      <View style={[styles.section, { marginTop: 0, padding: 18, gap: 13 }]}><Text style={styles.rowName}>LastCall · 0.4.0</Text>
        <Text style={styles.body}>Сервер хранит профиль и помогает находить собеседников. Текст, файлы и звонки идут по защищённому соединению между участниками; при необходимости WebRTC использует TURN.</Text>
        <Text style={styles.body}>Контакты, группы и недавняя переписка зашифрованы на устройстве. Ожидающие сообщения отправятся, когда оба участника будут доступны. Файлы до 5 МиБ доступны в текущем запуске и требуют соединения со всеми получателями.</Text>
        <Text style={styles.body}>Android-уведомления работают, только если Firebase настроен в сборке и на сервере и вы дали разрешение. Уведомление предлагает открыть LastCall; доставка текста требует доступности отправителя. После принудительной остановки приложения Android push не работает до ручного открытия. iOS push, фоновые входящие звонки, голосовые заметки и групповые звонки пока недоступны.</Text>
        <Text style={styles.info}>Прямое соединение раскрывает IP собеседнику. Эта предварительная версия не прошла независимый аудит, не использует Double Ratchet и не обещает невидимость для DPI. При удалении приложения ключ и локальная история могут быть утрачены.</Text>
      </View>
      <View style={styles.section}><Pressable style={styles.listRow} accessibilityRole="button" onPress={() => setShowDiagnostics(!showDiagnostics)}><Icon name="pulse-outline" /><Text style={[styles.rowName, styles.flex]}>Диагностика</Text><Icon name={showDiagnostics ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.secondary} /></Pressable>
        {showDiagnostics && <View style={styles.content}><Text selectable style={styles.info}>Ключ профиля: {identity?.userId}</Text>
          {snapshot.conversations.filter(item => item.kind === 'direct').map(item => <View key={item.id} style={{ gap: 5 }}><Text style={styles.rowName}>{item.title}</Text><Text style={styles.info}>Соединение: {item.session?.status ?? 'не установлено'} · {item.session?.route === 'direct' ? 'P2P напрямую' : item.session?.route === 'relay' ? 'через TURN' : 'маршрут не определён'}</Text><Text style={styles.info}>RTT {metric(item.session?.stats.rttMs, 'мс')} · аудио {metric(item.session?.stats.audioBitrateKbps, 'кбит/с')} · jitter {metric(item.session?.stats.jitterMs, 'мс')} · потери {item.session?.stats.packetsLost ?? '—'}</Text></View>)}
          <Text style={styles.info}>«—» означает, что WebRTC ещё не предоставил метрику. Отдельные диалоги используют независимые соединения.</Text>
          <Button title="Скопировать отчёт о соединении" secondary onPress={() => void copyDiagnostics()} />
          {reportCopied && <Text style={styles.info}>Отчёт скопирован. Известные имена, сообщения, телефоны и идентификаторы скрыты. Проверьте текст перед отправкой.</Text>}
        </View>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
