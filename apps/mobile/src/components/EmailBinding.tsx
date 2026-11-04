import { useReducer, useState } from 'react';
import { Text, View } from 'react-native';
import { bindEmail, requestEmailCode, useMessenger } from '../runtime';
import { emailErrorMessage, emailFlowReducer, emailForServer, emailNoticeMessage, initialEmailFlow, isEmailUnavailable } from '../email-flow-model';
import { styles } from '../styles';
import { t } from '../i18n';
import { Button, Icon } from './ui';
import { EmailCodeForm } from './EmailCodeForm';

/** Settings: add or change the address that can restore this account. */
export function EmailBinding() {
  const { profile, boundEmail, busy } = useMessenger();
  const [flow, dispatch] = useReducer(emailFlowReducer, initialEmailFlow('bind'));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const current = emailForServer(boundEmail, profile?.serverUrl);
  async function send(email: string) {
    setError('');
    try {
      const challengeId = await requestEmailCode('bind', email);
      if (challengeId) dispatch({ type: 'code-sent', email, challengeId, at: Date.now() });
    } catch (cause) {
      if (isEmailUnavailable(cause)) dispatch({ type: 'unavailable' });
      else setError(emailErrorMessage(cause));
    }
  }
  async function confirm(code: string) {
    if (!flow.challengeId) return;
    setError('');
    try {
      if (await bindEmail(flow.challengeId, code, flow.email)) { dispatch({ type: 'reset' }); setOpen(false); }
    } catch (cause) { setError(emailErrorMessage(cause)); }
  }
  return <View style={{ gap: 12 }}>
    {current ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="mail-outline" /><View style={styles.rowBody}><Text style={styles.rowName}>{current}</Text><Text style={styles.rowText}>{t('Used to restore this account after reinstalling.')}</Text></View></View>
      : <Text style={styles.body}>{t('No email is linked. Without it, this account is lost if you reinstall the app or lose this phone.')}</Text>}
    {open ? <>
      {flow.stage !== 'code' && <Text style={styles.info}>{current ? t('The new address replaces the current one. The current address is not notified.') : t('A code will be sent to the address to confirm it is yours.')}</Text>}
      {!!emailNoticeMessage(flow.notice) && <Text accessibilityRole="alert" style={styles.error}>{emailNoticeMessage(flow.notice)}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <EmailCodeForm flow={flow} busy={busy} codeHint={t('We sent a letter to {email}. Enter the 6-digit code from it. If this address already has another account, the letter explains that instead.', { email: flow.email })}
        onSend={email => void send(email)} onConfirm={code => void confirm(code)}
        onBack={() => { setError(''); if (flow.stage === 'code') dispatch({ type: 'back' }); else { dispatch({ type: 'reset' }); setOpen(false); } }} />
    </> : <Button secondary title={current ? t('Change email') : t('Add email')} onPress={() => setOpen(true)} />}
  </View>;
}
