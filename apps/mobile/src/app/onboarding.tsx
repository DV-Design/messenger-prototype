import { useEffect, useReducer, useRef, useState } from 'react';
import type { RegistrationPolicy, TelegramPurpose, TelegramSession } from '@messenger/core';
import { Redirect } from 'expo-router';
import { ActivityIndicator, AppState, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from '../components/SafeArea';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { Button, Icon } from '../components/ui';
import { emailErrorCode, emailErrorMessage, emailFlowReducer, emailNoticeMessage, initialEmailFlow, isEmailUnavailable, normalizeInviteCode, registrationErrorCode, registrationErrorMessage } from '../email-flow-model';
import { telegramErrorCode, telegramErrorMessage, telegramNextStep } from '../telegram-signup-model';
import { accessRequestState, checkRegistration, checkSignupOptions, checkTelegramSession, confirmRegistrationEmail, errorText, openTelegramSession, recoverAccount, registerProfile, requestEmailCode, sendAccessRequest, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
import { t } from '../i18n';

type Screen = 'home' | 'restore' | 'other' | 'telegram' | 'access' | 'access-sent';
interface SignupOptions { mode: RegistrationPolicy; telegram: boolean; accessRequests: boolean }

export default function Onboarding() {
  const { profile, identity, busy, error, registration } = useMessenger();
  const [flow, dispatch] = useReducer(emailFlowReducer, initialEmailFlow());
  const [screen, setScreen] = useState<Screen>('home');
  const [options, setOptions] = useState<SignupOptions>();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [localError, setLocalError] = useState('');
  const [policy, setPolicy] = useState<RegistrationPolicy>();
  const [policyLoading, setPolicyLoading] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  /** Registration with a number confirmed through Telegram: no email, no invitation. */
  const [phoneProof, setPhoneProof] = useState<{ proof: string; phone?: string }>();
  const [telegram, setTelegram] = useState<{ purpose: TelegramPurpose; session?: TelegramSession; expired?: boolean; refused?: string }>();
  const [access, setAccess] = useState({ name: '', contact: '', message: '' });
  const [accessState, setAccessState] = useState<'pending' | 'declined'>();
  const needsInvite = flow.mode === 'register' && policy === 'invite' && !phoneProof;
  const inviteCode = needsInvite ? normalizeInviteCode(inviteInput) : undefined;
  const shownError = localError || (error ? registrationErrorMessage(error) : '');
  const polling = useRef(false);

  // What this server offers; an older server answers without Telegram and the old screen stays.
  useEffect(() => {
    if (registration !== 'unregistered' || options) return;
    let active = true;
    void checkSignupOptions().then(value => {
      if (!active) return;
      setOptions(value);
      // A request made earlier from this phone: show its answer straight away.
      if (value.accessRequests) void accessRequestState().then(answer => {
        if (!active) return;
        if (answer.state === 'pending' || answer.state === 'declined') { setAccessState(answer.state); setScreen('access-sent'); }
        if (answer.state === 'approved' && answer.inviteCode) approved(answer.inviteCode);
      }).catch(() => { /* Asked again from the request screen. */ });
    }).catch(() => { if (active) setOptions({ mode: 'open', telegram: false, accessRequests: false }); });
    return () => { active = false; };
  }, [registration, options]);

  // While the Telegram screen is open: check now, every 2 s, and whenever the app comes back.
  useEffect(() => {
    const session = telegram?.session;
    if (screen !== 'telegram' || !session || telegram?.expired) return;
    let active = true;
    const check = async () => {
      if (!active || polling.current || AppState.currentState !== 'active') return;
      polling.current = true;
      try {
        const result = await checkTelegramSession(telegram.purpose, session.sessionId);
        if (!active) return;
        const next = telegramNextStep(telegram.purpose, result);
        if (next === 'expired') setTelegram(value => value && { ...value, expired: true });
        if (next === 'profile' && result.proof) {
          setPhoneProof({ proof: result.proof, phone: result.phone });
          setScreen('home'); dispatch({ type: 'choose', mode: 'register' }); dispatch({ type: 'verified', proof: result.proof });
        }
      } catch (cause) {
        if (active) { setLocalError(telegramErrorMessage(cause)); setTelegram(value => value && { ...value, expired: true, refused: telegramErrorCode(cause) }); }
      } finally { polling.current = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void check(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [screen, telegram]);

  // A sent request: look for the answer when the app comes back and every 30 s.
  useEffect(() => {
    if (screen !== 'access-sent' || accessState !== 'pending') return;
    let active = true;
    const check = () => void accessRequestState().then(answer => {
      if (!active) return;
      if (answer.state === 'approved' && answer.inviteCode) approved(answer.inviteCode);
      else if (answer.state === 'declined') setAccessState('declined');
    }).catch(() => { /* Next time. */ });
    const timer = setInterval(check, 30_000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') check(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [screen, accessState]);

  if (profile) return <Redirect href="/(tabs)" />;

  function approved(code: string) {
    setAccessState(undefined); setInviteInput(code); setPolicy('invite'); setScreen('home');
    dispatch({ type: 'reset' }); dispatch({ type: 'choose', mode: 'register' });
  }
  async function startTelegram(purpose: TelegramPurpose) {
    setLocalError(''); setPhoneProof(undefined); setTelegram({ purpose }); setScreen('telegram');
    try {
      const session = await openTelegramSession(purpose);
      setTelegram({ purpose, session });
      await Linking.openURL(session.url).catch(() => setLocalError(t('Could not open Telegram. Install it or open the link on another device.')));
    } catch (cause) { setLocalError(telegramErrorMessage(cause)); setTelegram({ purpose, expired: true }); }
  }
  async function createAccount(withInvite = false) {
    setPolicyLoading(true); setInviteInput(''); setLocalError(''); setPhoneProof(undefined);
    try {
      const next = withInvite ? 'invite' : (options?.mode ?? (await checkSignupOptions()).mode);
      setPolicy(next);
      if (next === 'closed') setLocalError(registrationErrorMessage('registration-closed'));
      else { setScreen('home'); dispatch({ type: 'choose', mode: 'register' }); }
    } catch { setLocalError(t('Could not check registration availability. Try again.')); }
    finally { setPolicyLoading(false); }
  }
  function registrationRefusal(code: string | undefined) {
    if (flow.mode !== 'register') return;
    if (code === 'invite-required' || code === 'invite-invalid') { setPolicy('invite'); if (code === 'invite-invalid') setInviteInput(''); }
    else if (code === 'registration-closed') { setInviteInput(''); setPolicy('closed'); dispatch({ type: 'reset' }); }
    else if (code === 'phone-proof-invalid') { setPhoneProof(undefined); dispatch({ type: 'reset' }); }
  }
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
    } catch (cause) { if (isEmailUnavailable(cause)) dispatch({ type: 'unavailable' }); else refused(cause); }
  }
  async function confirm(code: string) {
    if (!flow.challengeId) return;
    setLocalError('');
    try {
      if (flow.mode === 'recover') await recoverAccount(flow.challengeId, code, flow.email);
      else { const proof = await confirmRegistrationEmail(flow.challengeId, code); if (proof) dispatch({ type: 'verified', proof }); }
    } catch (cause) { refused(cause); }
  }
  async function register() {
    if (needsInvite && !inviteCode) return;
    setLocalError('');
    try {
      if (phoneProof) await registerProfile(displayName, username, undefined, undefined, undefined, phoneProof.proof);
      else await registerProfile(displayName, username, flow.proof, flow.email, inviteCode);
    } catch (cause) {
      const code = registrationErrorCode(errorText(cause));
      registrationRefusal(code);
      if (code) dispatch({ type: 'registration-failed', code });
      setLocalError(registrationErrorMessage(errorText(cause)));
    }
  }
  async function submitAccess() {
    setLocalError('');
    try {
      await sendAccessRequest({ name: access.name, contact: access.contact.trim() || undefined, message: access.message });
      setAccessState('pending'); setScreen('access-sent');
    } catch (cause) { setLocalError(telegramErrorMessage(cause)); }
  }
  const notice = emailNoticeMessage(flow.notice);
  const home = () => { setLocalError(''); setInviteInput(''); setPhoneProof(undefined); setTelegram(undefined); setScreen('home'); dispatch({ type: 'reset' }); };
  const back = () => {
    setLocalError('');
    if (flow.stage === 'email' || (flow.stage === 'profile' && phoneProof)) return home();
    dispatch({ type: 'back' });
  };
  const profileForm = flow.stage === 'profile';
  const choosing = registration === 'unregistered' && flow.stage === 'choose';
  const link = (title: string, onPress: () => void) => <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={{ paddingVertical: 6 }}><Text style={{ color: colors.accent, textAlign: 'center', fontSize: 16 }}>{title}</Text></Pressable>;
  const intro = registration !== 'unregistered' || (choosing && screen === 'home') ? t('A private messenger with a unique username. Messages and calls travel between participants.')
    : screen === 'telegram' ? (telegram?.purpose === 'recover' ? t('Restore your account with the phone number of your Telegram account.') : t('LastCall confirms your phone number through Telegram: no SMS, no email.'))
    : screen === 'access' || screen === 'access-sent' ? t('No Telegram? Write to the administrator. If they approve, an invitation arrives here and you sign up with email.')
    : flow.mode === 'recover' ? t('Restoring returns your @username and name to this phone. Chat history and contacts do not come back, the old device stops working, and your contacts will see that your key changed.')
    : profileForm ? t('Choose a unique username. The server binds it to this device key; it cannot be changed after registration.')
    : t('Your email confirms the account and lets you restore it after reinstalling the app.');

  return <SafeAreaView style={styles.whiteScreen}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.onboarding}><Image source={require('../../assets/lastcall-icon.png')} accessibilityLabel={t('LastCall logo: satellite antenna')} style={{ width: 112, height: 112, alignSelf: 'center', borderRadius: 24 }} resizeMode="contain" />
        <View><Text style={[styles.title, { textAlign: 'center', fontSize: 32 }]}>LastCall</Text>
          <Text style={[styles.body, { textAlign: 'center', marginTop: 12 }]}>{intro}</Text></View>

        {choosing && screen === 'home' && (options?.telegram ? <View style={{ gap: 12 }}>
          <Button title={t('Continue with Telegram')} disabled={!identity || busy} onPress={() => void startTelegram('register')} />
          <Button secondary title={t('Restore account')} disabled={!identity || busy} onPress={() => { setLocalError(''); setScreen('restore'); }} />
          {link(t('Other ways to sign up'), () => { setLocalError(''); setScreen('other'); })}
        </View> : <View style={{ gap: 12 }}>
          <Button title={t('Create account')} busy={policyLoading || !options} disabled={!identity || busy} onPress={() => void createAccount()} />
          <Button secondary title={t('Restore account')} disabled={!identity || busy || policyLoading} onPress={() => { setLocalError(''); setInviteInput(''); dispatch({ type: 'choose', mode: 'recover' }); }} />
        </View>)}

        {choosing && screen === 'restore' && <View style={{ gap: 12 }}>
          <Button title={t('Through Telegram (phone number)')} disabled={!identity || busy} onPress={() => void startTelegram('recover')} />
          <Button secondary title={t('Through email')} disabled={!identity || busy} onPress={() => { setLocalError(''); setScreen('home'); dispatch({ type: 'choose', mode: 'recover' }); }} />
          {link(t('Back'), home)}
        </View>}

        {choosing && screen === 'other' && <View style={{ gap: 12 }}>
          <Button secondary title={t('Sign up with email')} busy={policyLoading} disabled={!identity || busy} onPress={() => void createAccount()} />
          <Button secondary title={t('I have an invitation code')} disabled={!identity || busy || policyLoading} onPress={() => void createAccount(true)} />
          {options?.accessRequests && <Button secondary title={t('No Telegram? Ask for access')} disabled={!identity || busy} onPress={() => { setLocalError(''); setScreen('access'); }} />}
          {link(t('Back'), home)}
        </View>}

        {screen === 'telegram' && registration === 'unregistered' && <View style={{ gap: 12 }}>
          {!telegram?.session && !telegram?.expired && <ActivityIndicator color={colors.accent} />}
          {telegram?.session && !telegram.expired && <>
            <Text style={[styles.info, { padding: 12, borderRadius: 12, backgroundColor: '#EEF3F1', color: colors.text }]}>{t('In the LastCall bot, tap “Share my number”, then come back here. The number is used to sign in, restore the account and let people who know your number find you.')}</Text>
            <Button title={t('Open Telegram')} onPress={() => void Linking.openURL(telegram.session!.url).catch(() => setLocalError(t('Could not open Telegram. Install it or open the link on another device.')))} />
            <View style={[styles.row, { justifyContent: 'center', gap: 8 }]}><ActivityIndicator color={colors.accent} /><Text style={styles.info}>{t('Waiting for your number…')}</Text></View>
          </>}
          {telegram?.expired && (telegram.refused === 'phone-taken' ? <Button title={t('Restore this account')} disabled={!identity || busy} onPress={() => void startTelegram('recover')} />
            : telegram.refused === 'phone-no-account' ? <Button title={t('Create account')} disabled={!identity || busy} onPress={() => void startTelegram('register')} />
            : <Button title={t('Try again')} disabled={!identity || busy} onPress={() => void startTelegram(telegram.purpose)} />)}
          {options?.accessRequests && telegram?.purpose === 'register' && link(t('Can’t use Telegram?'), () => { setLocalError(''); setScreen('access'); })}
          {link(t('Back'), home)}
        </View>}

        {screen === 'access' && registration === 'unregistered' && <View style={{ gap: 10 }}>
          <View><Text style={styles.label}>{t('Your name')}</Text><TextInput style={styles.input} value={access.name} onChangeText={name => setAccess(value => ({ ...value, name }))} maxLength={48} placeholder={t('What is your name?')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Your name')} /></View>
          <View><Text style={styles.label}>{t('How to reach you (optional)')}</Text><TextInput style={styles.input} value={access.contact} onChangeText={contact => setAccess(value => ({ ...value, contact }))} maxLength={120} autoCapitalize="none" placeholder={t('Email, phone or another messenger')} placeholderTextColor={colors.secondary} accessibilityLabel={t('How to reach you (optional)')} /></View>
          <View><Text style={styles.label}>{t('Message to the administrator')}</Text><TextInput style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]} value={access.message} onChangeText={message => setAccess(value => ({ ...value, message }))} maxLength={500} multiline placeholder={t('Who you are and why you can’t use Telegram')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Message to the administrator')} /></View>
          <Button title={t('Send request')} busy={busy} disabled={!identity || !access.name.trim() || !access.message.trim()} onPress={() => void submitAccess()} />
          {link(t('Back'), home)}
        </View>}

        {screen === 'access-sent' && registration === 'unregistered' && <View style={{ gap: 12 }}>
          <View style={{ gap: 4, padding: 12, borderRadius: 12, backgroundColor: accessState === 'declined' ? '#FBEAEA' : '#EEF3F1' }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{accessState === 'declined' ? t('The request was declined') : t('Request sent')}</Text>
            <Text style={[styles.info, { color: colors.text }]}>{accessState === 'declined' ? t('You can still sign up through Telegram or with an invitation code from someone you know.') : t('The answer will appear here. If the administrator approves, the invitation code is filled in for you.')}</Text>
          </View>
          {link(t('Back'), home)}
        </View>}

        {registration === 'unregistered' && !!notice && !profileForm && screen === 'home' && <Text accessibilityRole="alert" style={styles.error}>{notice}</Text>}
        {registration === 'unregistered' && needsInvite && screen === 'home' && !choosing && <View style={{ gap: 8 }}>
          <View style={{ gap: 4, padding: 12, borderRadius: 12, backgroundColor: '#EEF3F1' }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{t('Registration is by invitation')}</Text>
            <Text style={[styles.info, { color: colors.text }]}>{t('Ask the person who recommended LastCall to you to send an invitation. You will get a message with a code: paste it here in full.')}</Text>
          </View>
          <Text style={styles.label}>{t('Invitation code')}</Text>
          <TextInput style={styles.input} value={inviteInput} onChangeText={setInviteInput} editable={!busy} maxLength={600} multiline autoCapitalize="none" autoCorrect={false} textContentType="none" placeholder={t('Paste the invitation message or code')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Invitation code')} />
        </View>}
        {registration === 'unregistered' && screen === 'home' && (flow.stage === 'email' || flow.stage === 'code') && <EmailCodeForm flow={flow} busy={busy} disabled={!identity} sendDisabled={needsInvite && !inviteCode}
          codeHint={flow.mode === 'recover' ? t('We sent a letter to {email}. Enter the 6-digit code from it. If no account uses this address, the letter says so instead.', { email: flow.email }) : t('We sent a letter to {email}. Enter the 6-digit code from it. If this address already has an account, the letter explains how to restore it instead.', { email: flow.email })}
          onSend={email => void send(email)} onConfirm={code => void confirm(code)} onBack={back} />}
        {registration === 'unregistered' && profileForm && screen === 'home' && <>
          {phoneProof ? <Text style={styles.info}>{t('Confirmed number: {phone}', { phone: phoneProof.phone ?? '' })}</Text>
            : flow.withoutEmail ? <Text style={[styles.info, { padding: 12, borderRadius: 10, backgroundColor: '#FFF2D8', color: '#7B5924' }]}>{t('Email confirmation is not available on this server. You can register without an address, but this account cannot be restored after reinstalling.')}</Text>
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
        {registration === 'unregistered' && profileForm && screen === 'home' && <><Button title={t('Register')} busy={busy} disabled={!identity || !displayName.trim() || username.trim().length < 3 || !termsAccepted || (needsInvite && !inviteCode)} onPress={() => void register()} />
          <Pressable accessibilityRole="button" disabled={busy} onPress={back}><Text style={{ color: colors.accent, textAlign: 'center' }}>{t('Back')}</Text></Pressable></>}
        <Text style={[styles.info, { textAlign: 'center' }]}> {t('The profile key is stored on this device. A confirmed number or email restores your @username after reinstalling, but not chats or contacts. Compare safety codes with your contacts afterwards. The server helps find friends, see their status and keeps end-to-end encrypted messages until delivery; calls and files travel between participants.')}</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
