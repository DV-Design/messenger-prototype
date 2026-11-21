import { useReducer, useState } from 'react';
import type { RegistrationPolicy } from '@messenger/core';
import { Redirect } from 'expo-router';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from '../components/SafeArea';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { Button, Icon } from '../components/ui';
import { emailErrorCode, emailErrorMessage, emailFlowReducer, emailNoticeMessage, initialEmailFlow, isEmailUnavailable, normalizeInviteCode, registrationErrorCode, registrationErrorMessage } from '../email-flow-model';
import { checkNewAccountPolicy, checkRegistration, confirmRegistrationEmail, errorText, recoverAccount, registerProfile, requestEmailCode, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
import { t } from '../i18n';
export default function Onboarding() {
  const { profile, identity, busy, error, registration } = useMessenger();
  const [flow, dispatch] = useReducer(emailFlowReducer, initialEmailFlow());
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [localError, setLocalError] = useState('');
  const [policy, setPolicy] = useState<RegistrationPolicy>();
  const [policyLoading, setPolicyLoading] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const needsInvite = flow.mode === 'register' && policy === 'invite';
  const inviteCode = needsInvite ? normalizeInviteCode(inviteInput) : undefined;
  const shownError = localError || (error ? registrationErrorMessage(error) : '');
  if (profile) return <Redirect href="/(tabs)" />;
  async function createAccount() {
    setPolicyLoading(true);
    setInviteInput('');
    setLocalError('');
    try {
      const next = await checkNewAccountPolicy();
      setPolicy(next);
      if (next === 'closed') setLocalError(registrationErrorMessage('registration-closed'));
      else dispatch({ type: 'choose', mode: 'register' });
    } catch {
      setLocalError(t('Could not check registration availability. Try again.'));
    } finally {
      setPolicyLoading(false);
    }
  }
  function registrationRefusal(code: string | undefined) {
    if (flow.mode !== 'register') return;
    if (code === 'invite-required' || code === 'invite-invalid') {
      setPolicy('invite');
      if (code === 'invite-invalid') setInviteInput('');
    } else if (code === 'registration-closed') {
      setInviteInput('');
      setPolicy('closed');
      dispatch({ type: 'reset' });
    }
  }
  /** The server already holds a profile for this key, so it must be picked up rather than created. */
  function refused(cause: unknown) {
    setLocalError(emailErrorMessage(cause));
    const code = emailErrorCode(cause);
    registrationRefusal(code);
    if (code === 'device-already-registered') void checkRegistration();
  }
  async function send(email: string) {
    if (!flow.mode || (needsInvite && !inviteCode)) return;
    setLocalError('');
    try {
      const challengeId = await requestEmailCode(flow.mode, email, inviteCode);
      if (challengeId) dispatch({ type: 'code-sent', email, challengeId, at: Date.now() });
    } catch (cause) {
      if (isEmailUnavailable(cause)) dispatch({ type: 'unavailable' });
      else refused(cause);
    }
  }
  async function confirm(code: string) {
    if (!flow.challengeId) return;
    setLocalError('');
    try {
      if (flow.mode === 'recover') await recoverAccount(flow.challengeId, code, flow.email);
      else {
        const proof = await confirmRegistrationEmail(flow.challengeId, code);
        if (proof) dispatch({ type: 'verified', proof });
      }
    } catch (cause) { refused(cause); }
  }
  async function register() {
    if (needsInvite && !inviteCode) return;
    setLocalError('');
    try { await registerProfile(displayName, username, flow.proof, flow.email, inviteCode); }
    catch (cause) {
      const code = registrationErrorCode(errorText(cause));
      registrationRefusal(code);
      if (code) dispatch({ type: 'registration-failed', code });
      setLocalError(registrationErrorMessage(errorText(cause)));
    }
  }
  const notice = emailNoticeMessage(flow.notice);
  const back = () => {
    setLocalError('');
    if (flow.stage === 'email') setInviteInput('');
    dispatch({ type: 'back' });
  };
  const profileForm = flow.stage === 'profile';
  return <SafeAreaView style={styles.whiteScreen}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.onboarding}><Image source={require('../../assets/lastcall-icon.png')} accessibilityLabel={t('LastCall logo: satellite antenna')} style={{ width: 112, height: 112, alignSelf: 'center', borderRadius: 24 }} resizeMode="contain" />
        <View><Text style={[styles.title, { textAlign: 'center', fontSize: 32 }]}>LastCall</Text>
          <Text style={[styles.body, { textAlign: 'center', marginTop: 12 }]}>{registration !== 'unregistered' || flow.stage === 'choose' ? t('A private messenger with a unique username. Messages and calls travel between participants.') : flow.mode === 'recover' ? t('Restoring returns your @username and name to this phone. Chat history and contacts do not come back, the old device stops working, and your contacts will see that your key changed.') : profileForm ? t('Choose a unique username. The server binds it to this device key; it cannot be changed after registration.') : t('Your email confirms the account and lets you restore it after reinstalling the app.')}</Text></View>
        {registration === 'unregistered' && flow.stage === 'choose' && <View style={{ gap: 12 }}>
          <Button title={t('Create account')} busy={policyLoading} disabled={!identity || busy} onPress={() => void createAccount()} />
          <Button secondary title={t('Restore account')} disabled={!identity || busy || policyLoading} onPress={() => { setLocalError(''); setInviteInput(''); dispatch({ type: 'choose', mode: 'recover' }); }} />
        </View>}
        {registration === 'unregistered' && !!notice && !profileForm && <Text accessibilityRole="alert" style={styles.error}>{notice}</Text>}
        {registration === 'unregistered' && needsInvite && <View style={{ gap: 8 }}>
          <View style={{ gap: 4, padding: 12, borderRadius: 12, backgroundColor: '#EEF3F1' }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{t('Registration is by invitation')}</Text>
            <Text style={[styles.info, { color: colors.text }]}>{t('Ask the person who recommended LastCall to you to send an invitation. You will get a message with a code: paste it here in full.')}</Text>
          </View>
          <Text style={styles.label}>{t('Invitation code')}</Text>
          <TextInput style={styles.input} value={inviteInput} onChangeText={setInviteInput} editable={!busy} maxLength={600} multiline autoCapitalize="none" autoCorrect={false} textContentType="none" placeholder={t('Paste the invitation message or code')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Invitation code')} />
        </View>}
        {registration === 'unregistered' && (flow.stage === 'email' || flow.stage === 'code') && <EmailCodeForm flow={flow} busy={busy} disabled={!identity} sendDisabled={needsInvite && !inviteCode}
          codeHint={flow.mode === 'recover' ? t('We sent a letter to {email}. Enter the 6-digit code from it. If no account uses this address, the letter says so instead.', { email: flow.email }) : t('We sent a letter to {email}. Enter the 6-digit code from it. If this address already has an account, the letter explains how to restore it instead.', { email: flow.email })}
          onSend={email => void send(email)} onConfirm={code => void confirm(code)} onBack={back} />}
        {registration === 'unregistered' && profileForm && <>
          {flow.withoutEmail ? <Text style={[styles.info, { padding: 12, borderRadius: 10, backgroundColor: '#FFF2D8', color: '#7B5924' }]}>{t('Email confirmation is not available on this server. You can register without an address, but this account cannot be restored after reinstalling.')}</Text>
            : <Text style={styles.info}>{t('Confirmed address: {email}', { email: flow.email })}</Text>}
          <View><Text style={styles.label}> {t('Your name')}</Text><TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} maxLength={48} placeholder={t('What is your name?')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Your name')} autoComplete="name" /></View>
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
        {!!shownError && <Text accessibilityRole="alert" style={styles.error}>{shownError}</Text>}
        {registration !== 'unregistered' && <><Text style={styles.body}>{registration === 'checking' ? t('Checking this device registration…') : t('Could not check registration. Try again when online. A new username is unavailable until the server confirms no binding.')}</Text><Button title={t('Check again')} busy={busy} disabled={!identity} onPress={() => { void checkRegistration(); }} /></>}
        {registration === 'unregistered' && profileForm && <><Button title={t('Register')} busy={busy} disabled={!identity || !displayName.trim() || username.trim().length < 3 || !termsAccepted || (needsInvite && !inviteCode)} onPress={() => void register()} />
          <Pressable accessibilityRole="button" disabled={busy} onPress={back}><Text style={{ color: colors.accent, textAlign: 'center' }}>{t('Back')}</Text></Pressable></>}
        <Text style={[styles.info, { textAlign: 'center' }]}> {t('The profile key is stored on this device. A confirmed email restores your @username after reinstalling, but not chats or contacts. Compare safety codes with your contacts afterwards. The server helps find friends and see their status; messages and calls travel between participants.')}</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
