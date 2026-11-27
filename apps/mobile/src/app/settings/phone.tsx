import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import type { PhoneVisibility, TelegramSession } from '@messenger/core';
import { ActionLink, MenuGroup, MenuRow, SettingsPage } from '../../components/ui';
import { checkTelegramSession, openTelegramSession, refreshPhoneState, setPhoneVisibility, useMessenger } from '../../runtime';
import { telegramErrorMessage } from '../../telegram-signup-model';
import { openTelegramBot } from '../../telegram-open';
import { TelegramCode } from '../../components/TelegramCode';
import { styles } from '../../styles';
import { t } from '../../i18n';

/** Settings → Account → Phone number: link through Telegram, and who may find you by it. */
export default function PhoneSettings() {
  const { phone, snapshot } = useMessenger();
  const [session, setSession] = useState<TelegramSession>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<PhoneVisibility>();
  const checking = useRef(false);
  useEffect(() => { if (snapshot.status === 'online') void refreshPhoneState(); }, [snapshot.status]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const check = async () => {
      if (!active || checking.current || AppState.currentState !== 'active') return;
      checking.current = true;
      try {
        const result = await checkTelegramSession('bind', session.sessionId);
        if (active && result.state !== 'pending') setSession(undefined);
        if (active && result.state === 'expired') setError(t('The link has expired. Try again.'));
      } catch (cause) { if (active) { setSession(undefined); setError(telegramErrorMessage(cause)); } }
      finally { checking.current = false; }
    };
    const timer = setInterval(() => void check(), 2000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void check(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [session]);
  async function link() {
    setError('');
    try {
      const next = await openTelegramSession('bind');
      setSession(next);
      await openTelegramBot(next.url).catch(() => setError(t('Could not open Telegram. Install it or open the link on another device.')));
    } catch (cause) { setError(telegramErrorMessage(cause)); }
  }
  async function choose(visibility: PhoneVisibility) {
    setError(''); setSaving(visibility);
    try { await setPhoneVisibility(visibility); } catch (cause) { setError(telegramErrorMessage(cause)); } finally { setSaving(undefined); }
  }
  const linked = phone?.phone;
  return <SettingsPage title={t('Phone number')}>
    <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
      {phone === undefined ? <ActivityIndicator /> : linked
        ? <Text style={styles.body}>{t('{phone} · confirmed through Telegram', { phone: linked })}</Text>
        : <Text style={styles.body}>{t('Link your number through Telegram: people who have it can find you, and you can restore the account by number.')}</Text>}
      {session ? <View style={{ gap: 10 }}><View style={[styles.row, { gap: 8 }]}><ActivityIndicator /><Text style={styles.info}>{t('Waiting for your number…')}</Text></View>{!!session.code && <TelegramCode code={session.code} />}<ActionLink icon="paper-plane-outline" title={t('Open Telegram')} onPress={() => void openTelegramBot(session.url).catch(() => setError(t('Could not open Telegram. Install it or open the link on another device.')))} /></View>
        : phone !== undefined && <ActionLink icon="paper-plane-outline" title={linked ? t('Change number through Telegram') : t('Link number through Telegram')} onPress={() => void link()} />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
    {!!linked && <MenuGroup title={t('WHO CAN FIND ME BY MY NUMBER')}>
      {(['everyone', 'contacts', 'nobody'] as const).map(value => <MenuRow key={value} busy={saving === value} icon={phone?.visibility === value ? 'radio-button-on' : 'radio-button-off'}
        title={value === 'everyone' ? t('Everyone') : value === 'contacts' ? t('My contacts') : t('Nobody')} onPress={() => void choose(value)} />)}
    </MenuGroup>}
    <Text style={[styles.info, { paddingHorizontal: 20, marginTop: 12 }]}>{t('The server keeps a protected fingerprint of the number and its last two digits, never your phone book. Russian numbers are also stored on a server in Russia.')}</Text>
  </SettingsPage>;
}
