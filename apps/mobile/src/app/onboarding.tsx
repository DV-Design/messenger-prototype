import { useState } from 'react';
import { Redirect } from 'expo-router';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { checkRegistration, errorText, registerProfile, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
export default function Onboarding() {
  const { profile, identity, busy, error, registration } = useMessenger();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [localError, setLocalError] = useState('');
  const shownError = (localError || error)?.replace(/^username-taken:.*$/, 'Этот логин уже занят. Выберите другой.').replace(/^device-already-registered:.*$/, 'На этом устройстве уже зарегистрирован логин. Восстановите профиль с сервера.');
  if (profile) return <Redirect href="/(tabs)" />;
  return <SafeAreaView style={styles.whiteScreen}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.onboarding}><Image source={require('../../assets/lastcall-icon.png')} accessibilityLabel="Логотип LastCall: спутниковая антенна" style={{ width: 112, height: 112, alignSelf: 'center', borderRadius: 24 }} resizeMode="contain" />
        <View><Text style={[styles.title, { textAlign: 'center', fontSize: 32 }]}>LastCall</Text><Text style={[styles.body, { textAlign: 'center', marginTop: 12 }]}>Выберите уникальный логин. Сервер закрепит его за ключом этого устройства; изменить логин после регистрации нельзя.</Text></View>
        {registration === 'unregistered' && <><View><Text style={styles.label}>Ваше имя</Text><TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} maxLength={48} placeholder="Как вас зовут?" placeholderTextColor={colors.secondary} accessibilityLabel="Ваше имя" autoComplete="name" /></View>
        <View><Text style={styles.label}>Имя пользователя</Text><View style={[styles.input, styles.row, { paddingVertical: 0 }]}><Text style={{ color: colors.accent, fontSize: 18 }}>@</Text><TextInput style={{ flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text }} value={username} onChangeText={setUsername} maxLength={24} autoCapitalize="none" autoCorrect={false} placeholder="username" placeholderTextColor={colors.secondary} accessibilityLabel="Имя пользователя" /></View><Text style={[styles.info, { marginTop: 8 }]}>3–24 латинские буквы, цифры и _. Логин фиксируется после подтверждения сервером. Имя может совпадать с именами других пользователей.</Text></View></>}
        {!!shownError && <Text style={styles.error}>{shownError}</Text>}
        {registration !== 'unregistered' ? <><Text style={styles.body}>{registration === 'checking' ? 'Проверяем регистрацию этого устройства…' : 'Не удалось проверить регистрацию. Повторите при подключении к сети. Новый логин нельзя выбрать, пока сервер не подтвердит отсутствие привязки.'}</Text><Button title="Проверить ещё раз" busy={busy} disabled={!identity} onPress={() => { void checkRegistration(); }} /></> : <Button title="Зарегистрироваться" busy={busy} disabled={!identity || !displayName.trim() || username.trim().length < 3} onPress={() => { setLocalError(''); void registerProfile(displayName, username).catch(cause => setLocalError(errorText(cause))); }} />}
        <Text style={[styles.info, { textAlign: 'center' }]}>Ключ профиля хранится на этом устройстве. Потерянный ключ нельзя восстановить по публичному логину. Сервер помогает находить друзей и видеть их статус; сообщения и звонки передаются между участниками.</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
