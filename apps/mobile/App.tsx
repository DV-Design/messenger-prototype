import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { RTCView, type MediaStream as NativeMediaStream } from 'react-native-webrtc';
import { createInvite, PeerSession, type SessionSnapshot } from '@messenger/core';
import { nativeRtc, validateServerUrl } from './src/native';
import { colors, styles } from './src/styles';

const MAX_FILE = 5 * 1024 * 1024;
const empty: SessionSnapshot = { status: 'idle', messages: [], callState: 'idle', muted: false, route: 'unknown', stats: {}, files: [] };
const statusText: Record<SessionSnapshot['status'], string> = { idle: 'Не подключено', connecting: 'Подключаемся…', waiting: 'Ждём собеседника', connected: 'На связи', disconnected: 'Соединение закрыто', error: 'Ошибка соединения' };
const fileText = { sending: 'Передаётся', receiving: 'Принимается', complete: 'Передан', error: 'Ошибка' };
const bytes = (size: number) => size < 1024 ? `${size} Б` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`;
const measurement = (value: number | undefined, unit: string) => value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} ${unit}`;

function Button({ title, onPress, disabled = false, subtle = false, danger = false }: { title: string; onPress: () => void; disabled?: boolean; subtle?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title === '↑' ? 'Отправить сообщение' : title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, subtle && styles.buttonSubtle, danger && styles.buttonDanger, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, subtle && styles.buttonTextSubtle, danger && styles.buttonTextDanger]}>{title}</Text>
  </Pressable>;
}
function Video({ stream, local = false }: { stream?: MediaStream; local?: boolean }) {
  if (!stream?.getVideoTracks().length) return null;
  return <View style={styles.videoWrap}><RTCView streamURL={(stream as unknown as NativeMediaStream).toURL()} style={styles.video} objectFit="cover" mirror={local} />
    <Text style={styles.videoLabel}>{local ? 'Вы' : 'Собеседник'}</Text></View>;
}
export default function App() { return <SafeAreaProvider><Messenger /></SafeAreaProvider>; }
function Messenger() {
  const session = useRef<PeerSession | null>(null);
  const systemSheet = useRef(false);
  const history = useRef<ComponentRef<typeof ScrollView>>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(empty);
  const [server, setServer] = useState(process.env.EXPO_PUBLIC_SIGNALING_URL ?? 'https://p2p.lienad.ru');
  const [invite, setInvite] = useState('');
  const [relayOnly, setRelayOnly] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showSetup, setShowSetup] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const active = ['connecting', 'waiting', 'connected'].includes(snapshot.status);
  const connected = snapshot.status === 'connected';
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'background' && !systemSheet.current && session.current) {
        session.current.disconnect(); session.current = null;
        setNotice('Приложение свёрнуто: сеанс закрыт. Для продолжения подключитесь снова.'); setShowSetup(true);
      }
    });
    return () => { listener.remove(); session.current?.disconnect(); };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Действие не удалось. Повторите попытку.'); }
    finally { setBusy(false); }
  }
  async function withSystemSheet<T,>(action: () => Promise<T>): Promise<T> {
    // Android's document/photo picker is another Activity. Its temporary
    // AppState transition must not disconnect the transfer being composed.
    systemSheet.current = true;
    try { return await action(); } finally { systemSheet.current = false; }
  }
  async function connect() {
    const serverUrl = validateServerUrl(server);
    if (!/^[0-9a-f]{64}$/.test(invite.trim())) throw new Error('Приглашение должно содержать 64 символа: цифры и буквы a–f.');
    session.current?.disconnect();
    let next: PeerSession;
    next = new PeerSession({ serverUrl, invite: invite.trim(), relayOnly, ...nativeRtc,
      onChange: value => { if (session.current === next) setSnapshot(value); } });
    session.current = next; setSnapshot(next.getSnapshot());
    await next.connect(); setShowSetup(false);
  }
  function disconnect() { session.current?.disconnect(); session.current = null; setShowSetup(true); }
  async function transmit(uri: string, name: string, mime: string, reportedSize?: number) {
    const current = session.current;
    if (!current || current.getSnapshot().status !== 'connected') throw new Error('Сначала подключите собеседника.');
    const file = new File(uri);
    if ((reportedSize ?? file.size) > MAX_FILE || file.size > MAX_FILE) throw new Error('В прототипе можно передавать файлы не больше 5 МиБ.');
    const data = await file.bytes();
    if (data.byteLength > MAX_FILE) throw new Error('Файл больше 5 МиБ.');
    if (current !== session.current) throw new Error('Сеанс завершён. Подключитесь снова.');
    await current.sendFile({ name, mime, data });
  }
  async function pickDocument() {
    const result = await withSystemSheet(() => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false }));
    const asset = result.assets?.[0];
    if (!result.canceled && asset) await transmit(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream', asset.size);
  }
  async function pickMedia() {
    const permission = await withSystemSheet(() => ImagePicker.requestMediaLibraryPermissionsAsync());
    if (!permission.granted) throw new Error('Разрешите выбор фото и видео в настройках телефона.');
    const result = await withSystemSheet(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false }));
    const asset = result.assets?.[0];
    if (!result.canceled && asset) await transmit(asset.uri, asset.fileName ?? (asset.type === 'video' ? 'video.mp4' : 'photo.jpg'), asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'), asset.fileSize);
  }
  async function openFile(item: SessionSnapshot['files'][number]) {
    if (!item.data) throw new Error('Данные файла больше не доступны в этом сеансе.');
    if (!(await Sharing.isAvailableAsync())) throw new Error('На устройстве недоступно меню сохранения файлов.');
    const safeName = item.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'file';
    const file = new File(Paths.cache, `${item.id.replace(/[^a-zA-Z0-9-]/g, '')}-${safeName}`);
    await file.write(item.data);
    try { await withSystemSheet(() => Sharing.shareAsync(file.uri, { mimeType: item.mime, dialogTitle: 'Сохранить или открыть файл' })); }
    finally { if (file.exists) file.delete(); }
  }
  return <SafeAreaView style={styles.safe}><StatusBar style="light" />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}><View style={styles.mark}><Text style={styles.markText}>↗</Text></View>
        <View style={styles.flex}><Text style={styles.eyebrow}>ПРОТОТИП · 1:1</Text><Text style={styles.title}>Мессенджер</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="О прототипе" hitSlop={12} onPress={() => setShowInfo(!showInfo)}><Text style={styles.infoButton}>ⓘ</Text></Pressable>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.statusBar}><View style={[styles.dot, connected && styles.dotConnected]} /><Text style={styles.statusText}>{statusText[snapshot.status]}</Text>
          <Pressable accessibilityRole="button" onPress={() => setShowSetup(!showSetup)} hitSlop={8}><Text style={styles.link}>{showSetup ? 'Скрыть' : 'Подключение'}</Text></Pressable></View>
        {showInfo && <View style={styles.card}>
          <Text style={styles.sectionTitle}>Что умеет эта сборка</Text>
          <Text style={styles.body}>Текст, файлы до 5 МиБ и звонки между двумя участниками. Оба устройства должны держать приложение открытым.</Text>
          <Text style={styles.body}>Только передний план. Нет офлайн-доставки, фоновых push-уведомлений и сохранённой истории. При сворачивании сеанс закрывается. Нет голосовых заметок, групп и синхронизации устройств.</Text>
          <Text style={styles.body}>Это технический прототип без завершённого аудита безопасности и ratchet-протокола. Не используйте для чувствительных данных. Не гарантирует обход DPI и разборчивость при обрыве сети.</Text>
          <Text style={styles.body}>Прямое соединение раскрывает ваш IP собеседнику. «Только через TURN» требует настроенного relay-сервера.</Text>
          <Button title="Понятно" subtle onPress={() => setShowInfo(false)} />
        </View>}
        {showSetup && <View style={styles.card}>
          <Text style={styles.sectionTitle}>Один сервер. Одно приглашение.</Text>
          <Text style={styles.body}>Укажите одинаковый сервер на обоих устройствах. Передайте приглашение собеседнику по доверенному каналу.</Text>
          <Text style={styles.label}>АДРЕС СЕРВЕРА</Text>
          <TextInput style={styles.input} accessibilityLabel="Адрес сервера" value={server} onChangeText={setServer} placeholder="https://your-server.example" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!active && !busy} />
          <View style={styles.rowBetween}><Text style={styles.label}>СЕКРЕТНОЕ ПРИГЛАШЕНИЕ</Text><Text style={styles.mini}>{invite.trim().length}/64</Text></View>
          <TextInput style={[styles.input, styles.secret]} accessibilityLabel="Секретное приглашение" value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} multiline textContentType="none" placeholder="Создайте или вставьте 64 символа" placeholderTextColor={colors.muted} editable={!active && !busy} />
          <View style={styles.row}>
            <Button title="Создать" subtle disabled={active || busy} onPress={() => void run(async () => { setInvite(createInvite(Crypto.getRandomBytes)); setNotice('Передайте приглашение только вашему собеседнику.'); })} />
            <Button title="Вставить" subtle disabled={active || busy} onPress={() => void run(async () => { setInvite((await Clipboard.getStringAsync()).trim()); })} />
            <Button title="Копировать" subtle disabled={!invite || busy} onPress={() => void run(async () => { await Clipboard.setStringAsync(invite.trim()); setNotice('Секрет скопирован. Очистите буфер обмена после передачи.'); })} />
          </View>
          <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.bodyStrong}>Только через TURN</Text><Text style={styles.small}>Без прямого соединения. Нужен relay на сервере.</Text></View>
            <Switch value={relayOnly} onValueChange={setRelayOnly} disabled={active || busy} accessibilityLabel="Только через TURN" trackColor={{ false: '#30434B', true: '#237E70' }} thumbColor="#E2F5EF" /></View>
          <Button title={active ? 'Отключиться' : busy ? 'Подключаемся…' : 'Подключиться'} danger={active} disabled={busy} onPress={() => active ? disconnect() : void run(connect)} />
          <Text style={styles.small}>Нужен development build. Expo Go не поддерживает WebRTC.</Text>
        </View>}
        {(error || snapshot.error) && <View style={styles.errorBox}><Text accessibilityRole="alert" style={styles.errorText}>{error || snapshot.error}</Text></View>}
        {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
        <View style={styles.callCard}>
          <Text style={styles.sectionTitle}>Звонок</Text>
          <Text style={styles.small}>{snapshot.callState === 'active' ? 'Соединение установлено' : snapshot.callState === 'incoming' ? 'Входящий вызов' : snapshot.callState === 'outgoing' ? 'Ожидаем ответа…' : 'Голос и видео напрямую, когда сеть позволяет'}</Text>
          {snapshot.callState === 'idle' ? <View style={styles.row}>
            <Button title="Аудиозвонок" disabled={!connected || busy} onPress={() => void run(async () => { await withSystemSheet(async () => session.current?.startCall(false)); })} />
            <Button title="Видеозвонок" subtle disabled={!connected || busy} onPress={() => void run(async () => { await withSystemSheet(async () => session.current?.startCall(true)); })} />
          </View> : <><Video stream={snapshot.remoteStream} /><Video stream={snapshot.localStream} local />
            <View style={styles.row}>{snapshot.callState === 'incoming' ? <>
              <Button title="Принять" disabled={busy} onPress={() => void run(async () => { await withSystemSheet(async () => session.current?.acceptCall()); })} />
              <Button title="Отклонить" danger onPress={() => session.current?.rejectCall()} />
            </> : <><Button title={snapshot.muted ? 'Включить микрофон' : 'Выключить микрофон'} subtle onPress={() => session.current?.setMuted(!snapshot.muted)} />
              <Button title="Завершить" danger onPress={() => session.current?.endCall()} /></>}</View></>}
        </View>
        <View style={styles.rowBetween}><Text style={styles.sectionTitle}>Переписка</Text><Text style={styles.mini}>В ЭТОМ СЕАНСЕ</Text></View>
        {snapshot.messages.length === 0 && snapshot.files.length === 0 && <View style={styles.empty}>
          <Text style={styles.emptySymbol}>↔</Text><Text style={styles.emptyTitle}>Разговор начинается здесь</Text>
          <Text style={styles.emptyText}>Подключите два устройства с одним приглашением.{"\n"}Сообщения появятся после отправки.</Text></View>}
        <ScrollView ref={history} style={styles.history} nestedScrollEnabled onContentSizeChange={() => history.current?.scrollToEnd({ animated: true })}>
          {snapshot.messages.map(item => <View key={item.id} style={[styles.bubble, item.from === 'self' && styles.bubbleSelf]}>
            <Text selectable style={styles.message}>{item.text}</Text><Text style={styles.messageTime}>{item.from === 'self' ? 'Вы' : 'Собеседник'} · {new Date(item.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</Text></View>)}
          {snapshot.files.map(item => <View key={item.id} style={styles.fileCard}><Text numberOfLines={2} style={styles.bodyStrong}>{item.from === 'self' ? '↑' : '↓'} {item.name}</Text>
            <Text style={styles.small}>{bytes(item.size)} · {fileText[item.status]}{item.status === 'receiving' ? ` · ${Math.min(100, Math.round(item.receivedBytes / Math.max(1, item.size) * 100))}%` : ''}</Text>
            {item.status === 'complete' && item.data && <Button title="Открыть / сохранить" subtle disabled={busy} onPress={() => void run(() => openFile(item))} />}</View>)}
        </ScrollView>
        <View style={styles.diagnostics}><Pressable accessibilityRole="button" style={styles.rowBetween} onPress={() => setShowDiagnostics(!showDiagnostics)}><Text style={styles.bodyStrong}>Диагностика соединения</Text><Text style={styles.link}>{showDiagnostics ? '−' : '+'}</Text></Pressable>
          <Text style={styles.small}>Маршрут: {snapshot.route === 'direct' ? 'напрямую' : snapshot.route === 'relay' ? 'через TURN' : 'ещё не определён'}</Text>
          {showDiagnostics && <View style={styles.stats}><Text style={styles.stat}>RTT   {measurement(snapshot.stats.rttMs, 'мс')}</Text><Text style={styles.stat}>Аудио   {measurement(snapshot.stats.audioBitrateKbps, 'кбит/с')}</Text><Text style={styles.stat}>Jitter   {measurement(snapshot.stats.jitterMs, 'мс')}</Text><Text style={styles.stat}>Потеряно пакетов   {snapshot.stats.packetsLost ?? '—'}</Text><Text style={styles.small}>«—» означает, что WebRTC ещё не предоставил метрику. Адаптация ограничена возможностями устройства и сети.</Text></View>}
        </View><Text style={styles.footer}>Только пока оба приложения открыты.{"\n"}История не сохраняется между сеансами.</Text>
      </ScrollView>
      <View style={styles.composer}><View style={styles.row}>
        <Button title="Фото / видео" subtle disabled={!connected || busy} onPress={() => void run(pickMedia)} /><Button title="Файл до 5 МиБ" subtle disabled={!connected || busy} onPress={() => void run(pickDocument)} />
        {!showSetup && active && <Button title="Выйти" subtle onPress={disconnect} />}</View>
        <View style={styles.composeRow}><TextInput accessibilityLabel="Текст сообщения" style={styles.messageInput} value={draft} onChangeText={setDraft} maxLength={4000} multiline placeholder={connected ? 'Сообщение…' : 'Подключитесь для переписки'} placeholderTextColor={colors.muted} editable={connected} />
          <Button title="↑" disabled={!connected || !draft.trim() || busy} onPress={() => void run(async () => { const current = session.current; if (!current) throw new Error('Нет активного соединения.'); await current.sendText(draft); setDraft(''); })} />
        </View></View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
