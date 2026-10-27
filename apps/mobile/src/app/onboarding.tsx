import { useState } from 'react';
import { Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon } from '../components/ui';
import { registerProfile, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
export default function Onboarding() {
  const { profile, identity, busy, error } = useMessenger();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  if (profile) return <Redirect href="/(tabs)" />;
  return <SafeAreaView style={styles.whiteScreen}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.onboarding}><View style={styles.heroIcon}><Icon name="chatbubbles" size={49} /></View>
        <View><Text style={[styles.title, { textAlign: 'center', fontSize: 32 }]}>LastCall</Text><Text style={[styles.body, { textAlign: 'center', marginTop: 12 }]}>Создайте профиль, чтобы друзья могли найти вас по имени пользователя.</Text></View>
        <View><Text style={styles.label}>Ваше имя</Text><TextInput autoFocus style={styles.input} value={displayName} onChangeText={setDisplayName} maxLength={48} placeholder="Как вас зовут?" placeholderTextColor={colors.secondary} accessibilityLabel="Ваше имя" autoComplete="name" /></View>
        <View><Text style={styles.label}>Имя пользователя</Text><View style={[styles.input, styles.row, { paddingVertical: 0 }]}><Text style={{ color: colors.accent, fontSize: 18 }}>@</Text><TextInput style={{ flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text }} value={username} onChangeText={setUsername} maxLength={24} autoCapitalize="none" autoCorrect={false} placeholder="username" placeholderTextColor={colors.secondary} accessibilityLabel="Имя пользователя" /></View><Text style={[styles.info, { marginTop: 8 }]}>3–24 латинские буквы, цифры и _. Номер телефона не нужен.</Text></View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button title="Продолжить" busy={busy} disabled={!identity || !displayName.trim() || username.trim().length < 3} onPress={() => { void registerProfile(displayName, username).catch(() => {}); }} />
        <Text style={[styles.info, { textAlign: 'center' }]}>Ключ профиля хранится на этом устройстве. Сервер помогает находить друзей и видеть их статус; сообщения и звонки передаются между участниками.</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
