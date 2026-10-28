import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Alert, AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizePhone, type DirectoryUser, type PhoneChallenge } from '@messenger/core';
import { Avatar, Button, IconButton } from '../components/ui';
import { setDiscoveryEnabled, syncDiscovery, useDiscovery } from '../discovery';
import { hasAccess } from '../permission-model';
import { requestPermission } from '../permissions';
import { client, errorText, useMessenger } from '../runtime';
import { useServices } from '../service-state';
import { colors, styles } from '../styles';
export default function PhoneScreen() {
  const { profile } = useMessenger();
  return <PhonePanel key={profile?.serverUrl} />;
}
function PhonePanel() {
  const { snapshot } = useMessenger();
  const { capabilities, error: serviceError, refresh } = useServices();
  const discovery = useDiscovery();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<PhoneChallenge>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; const resume = AppState.addEventListener('change', value => { if (value === 'active') refresh(); }); return () => { mounted.current = false; resume.remove(); }; }, [refresh]);
  useEffect(() => { if (!challenge) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [challenge]);
  async function sendCode() {
    const current = client();
    setBusy('send'); setError('');
    try {
      const e164 = normalizePhone(phone, 'RU');
      const next = await current.startPhoneVerification(e164);
      if (mounted.current && current === client()) { setPhone(e164); setChallenge(next); setCode(''); setNow(Date.now()); }
    } catch (cause) { if (mounted.current && current === client()) setError(errorText(cause)); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function verify() {
    if (!challenge || !/^\d{6}$/.test(code)) return;
    const current = client();
    setBusy('verify'); setError('');
    try {
      await current.verifyPhone(challenge.challengeId, code);
      if (mounted.current && current === client()) { setCode(''); setPhone(''); setChallenge(undefined); refresh(); }
    } catch (cause) { if (mounted.current && current === client()) setError(errorText(cause)); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function enableDiscovery() {
    setBusy('consent'); setError('');
    try {
      if (!hasAccess(await requestPermission('contacts'))) throw new Error('Разрешите доступ к контактам в настройках приложения.');
      if (!mounted.current) return;
      await setDiscoveryEnabled(true);
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { if (mounted.current) setBusy(''); }
  }
  function confirmDiscovery() {
    Alert.alert('Включить автопоиск контактов?', 'LastCall отправит серверу хеши номеров из доступных контактов и будет обновлять совпадения при открытии приложения. Имена и исходные номера книги остаются на устройстве. Хеши можно перебрать: это персональные данные, а не анонимный поиск. Номера без + трактуются как российские (+7).', [
      { text: 'Отмена', style: 'cancel' }, { text: 'Согласен, включить', onPress: () => { void enableDiscovery(); } },
    ]);
  }
  async function disableDiscovery() {
    try { await setDiscoveryEnabled(false); } catch (cause) { setError(errorText(cause)); }
  }
  async function open(user: DirectoryUser) {
    const current = client(); setBusy(user.userId); setError('');
    try { const id = await current.addContact(user); if (mounted.current && current === client()) router.push({ pathname: '/chat/[id]', params: { id } }); }
    catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { if (mounted.current) setBusy(''); }
  }
  const online = snapshot.status === 'online';
  const verified = capabilities?.phoneVerified === true;
  const retrySeconds = challenge ? Math.max(0, Math.ceil((challenge.retryAt - now) / 1000)) : 0;
  const expired = !!challenge && challenge.expiresAt <= now;
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><IconButton name="chevron-back" label="Назад" onPress={() => router.back()} /><Text style={[styles.title, { fontSize: 24 }]}>Номер и контакты</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={[styles.section, styles.content]}><Text style={styles.rowName}>{verified ? 'Номер подтверждён' : 'Подтвердите свой номер'}</Text>
        <Text style={styles.body}>Номер нужен для автоматического поиска знакомых. Переписка по @username и ручное добавление контактов доступны без него.</Text>
        {!online ? <Text style={styles.info}>Для проверки номера подключитесь к серверу.</Text> : !capabilities ? <><Text style={styles.info}>{serviceError ?? 'Проверяем доступность сервисов…'}</Text><Button title="Проверить сервисы" secondary onPress={refresh} /></> : !verified && !capabilities.phoneVerification ? <Text style={styles.info}>SMS-подтверждение пока не настроено на этом сервере. Код не отправляется.</Text> : !verified && <>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} editable={!busy && !challenge} maxLength={32} keyboardType="phone-pad" autoComplete="tel" placeholder="+7 999 123-45-67" accessibilityLabel="Ваш номер телефона" />
          <Text style={styles.info}>Международный формат с +. Номер без + трактуется как российский. Ваш номер получат сервер и SMS-провайдер; в публичном профиле он не показывается.</Text>
          <Button title={retrySeconds > 0 ? `Повторить через ${retrySeconds} с` : challenge ? 'Отправить код повторно' : 'Получить SMS-код'} busy={busy === 'send'} disabled={!!busy || !phone.trim() || retrySeconds > 0} onPress={() => void sendCode()} />
          {challenge && <><Button title="Указать другой номер" secondary disabled={!!busy || retrySeconds > 0} onPress={() => { setChallenge(undefined); setCode(''); }} /><Text style={styles.info}>{expired ? 'Код истёк. Запросите новый.' : 'Введите 6 цифр из SMS. Код действует 5 минут.'}</Text><TextInput style={styles.input} value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} maxLength={6} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" secureTextEntry accessibilityLabel="Шестизначный код из SMS" /><Button title="Подтвердить номер" busy={busy === 'verify'} disabled={!!busy || code.length !== 6 || expired} onPress={() => void verify()} /></>}
        </>}
      </View>
      <View style={[styles.section, styles.content]}><Text style={styles.rowName}>Автопоиск контактов</Text><Text style={styles.body}>Находит только профили с подтверждёнными номерами. Отправляются хеши, без имён и исходных номеров телефонной книги. Хеши номеров допускают перебор. Поиск обновляется при открытии приложения; можно отключить в любой момент.</Text>
        <Text style={styles.info}>Локальные номера без +: Россия (+7). Максимум 2000 контактов и 5000 разных номеров за обновление. При ограниченном доступе ищем только среди выбранных контактов.</Text>
        {!discovery.ready ? <Text style={styles.info}>Загружаем настройку…</Text> : discovery.enabled ? <><Text style={[styles.info, { color: colors.accent }]}>{discovery.consentSaveFailed ? 'Отключение не сохранено; поиск приостановлен' : 'Автопоиск включён'}</Text><Button title="Обновить совпадения" secondary busy={discovery.busy} disabled={!online || !!busy || !verified || discovery.consentSaveFailed} onPress={() => void syncDiscovery()} /><Button title="Отключить автопоиск" secondary disabled={!!busy} onPress={() => void disableDiscovery()} /></> : <Button title="Включить автопоиск…" disabled={!online || !verified || !!busy} busy={busy === 'consent'} onPress={confirmDiscovery} />}
        {!verified && <Text style={styles.info}>Сначала подтвердите свой номер. Ручные контакты продолжают работать.</Text>}
        {discovery.updatedAt && <Text style={styles.info}>Обновлено: {new Date(discovery.updatedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}. Найдено: {discovery.matches.length}.</Text>}
        {!!discovery.error && <Text style={styles.error}>{discovery.error}</Text>}
        <Button title="Контакты телефона: ручной режим" secondary onPress={() => router.push('/phonebook')} />
      </View>
      {!!error && <Text style={[styles.error, { margin: 18 }]}>{error}</Text>}
      {discovery.matches.map(match => <Pressable key={match.user.userId} style={styles.listRow} accessibilityRole="button" disabled={!!busy} onPress={() => void open(match.user)}><Avatar name={match.localName} id={match.user.userId} /><View style={styles.rowBody}><Text style={styles.rowName}>{match.localName}</Text><Text style={styles.rowText}>@{match.user.username} · номер подтверждён</Text></View><IconButton name="chatbubble-outline" label={`Открыть чат с ${match.localName}`} disabled={!!busy} onPress={() => void open(match.user)} /></Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
