import { useState } from 'react';
import { Redirect } from 'expo-router';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon } from '../components/ui';
import { checkRegistration, errorText, registerProfile, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
import { t } from '../i18n';
export default function Onboarding() {
  const { profile, identity, busy, error, registration } = useMessenger();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [localError, setLocalError] = useState('');
  const shownError = (localError || error)?.replace(/^username-taken:.*$/, t('This username is already taken. Choose another.')).replace(/^device-already-registered:.*$/, t('This device already has a registered username. Restore the profile from the server.'));
  if (profile) return <Redirect href="/(tabs)" />;
  return <SafeAreaView style={styles.whiteScreen}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.onboarding}><Image source={require('../../assets/lastcall-icon.png')} accessibilityLabel={t('LastCall logo: satellite antenna')} style={{ width: 112, height: 112, alignSelf: 'center', borderRadius: 24 }} resizeMode="contain" />
        <View><Text style={[styles.title, { textAlign: 'center', fontSize: 32 }]}>LastCall</Text><Text style={[styles.body, { textAlign: 'center', marginTop: 12 }]}> {t('Choose a unique username. The server binds it to this device key; it cannot be changed after registration.')}</Text></View>
        {registration === 'unregistered' && <><View><Text style={styles.label}> {t('Your name')}</Text><TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} maxLength={48} placeholder={t('What is your name?')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Your name')} autoComplete="name" /></View>
        <View><Text style={styles.label}> {t('Username')}</Text><View style={[styles.input, styles.row, { paddingVertical: 0 }]}><Text style={{ color: colors.accent, fontSize: 18 }}>@</Text><TextInput style={{ flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text }} value={username} onChangeText={setUsername} maxLength={24} autoCapitalize="none" autoCorrect={false} placeholder="username" placeholderTextColor={colors.secondary} accessibilityLabel={t('Username')} /></View><Text style={[styles.info, { marginTop: 8 }]}> {t('3–24 Latin letters, digits and _. The username is fixed after server confirmation. Display names may repeat.')}</Text></View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: termsAccepted }} onPress={() => setTermsAccepted(value => !value)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Icon name={termsAccepted ? 'checkbox' : 'square-outline'} size={24} />
          <Text style={[styles.rowText, { flex: 1 }]}> {t('I accept the Terms of use and Community guidelines.')}</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginLeft: 34 }}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://p2p.lienad.ru/terms.html').catch(() => setLocalError(t('Could not open the terms.')))}><Text style={{ color: colors.accent }}>{t('Terms of use')}</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://p2p.lienad.ru/community.html').catch(() => setLocalError(t('Could not open community guidelines.')))}><Text style={{ color: colors.accent }}>{t('Community guidelines')}</Text></Pressable>
        </View>
        </>}
        {!!shownError && <Text style={styles.error}>{shownError}</Text>}
        {registration !== 'unregistered' ? <><Text style={styles.body}>{registration === 'checking' ? t('Checking this device registration…') : t('Could not check registration. Try again when online. A new username is unavailable until the server confirms no binding.')}</Text><Button title={t('Check again')} busy={busy} disabled={!identity} onPress={() => { void checkRegistration(); }} /></> : <Button title={t('Register')} busy={busy} disabled={!identity || !displayName.trim() || username.trim().length < 3 || !termsAccepted} onPress={() => { setLocalError(''); void registerProfile(displayName, username).catch(cause => setLocalError(errorText(cause))); }} />}
        <Text style={[styles.info, { textAlign: 'center' }]}> {t('The profile key is stored on this device. A lost key cannot be recovered from the public username. The server helps find friends and see their status; messages and calls travel between participants.')}</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
