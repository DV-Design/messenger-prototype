import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { RESEND_SECONDS, resendSecondsLeft, sanitizeCode, validCode, validEmail, type EmailFlowState } from '../email-flow-model';
import { colors, styles } from '../styles';
import { t } from '../i18n';
import { Button } from './ui';

type Props = { flow: EmailFlowState; busy: boolean; disabled?: boolean; codeHint: string; onSend: (email: string) => void; onConfirm: (code: string) => void; onBack: () => void };
/** Both steps of confirming a mailbox; the caller owns the flow and the requests. A new step or letter starts with fresh inputs. */
export function EmailCodeForm(props: Props) {
  return <EmailStep key={`${props.flow.stage}:${props.flow.sentAt ?? 0}:${props.flow.email}`} {...props} />;
}
function EmailStep({ flow, busy, disabled, codeHint, onSend, onConfirm, onBack }: Props) {
  const [email, setEmail] = useState(flow.email);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const counting = flow.stage === 'code' && resendSecondsLeft(flow.sentAt, now) > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  const seconds = resendSecondsLeft(flow.sentAt, now);
  const address = validEmail(email);
  if (flow.stage === 'code') return <View style={{ gap: 12 }}>
    <Text style={styles.body}>{codeHint}</Text>
    <View><Text style={styles.label}>{t('Confirmation code')}</Text>
      <TextInput style={styles.input} value={code} onChangeText={value => setCode(sanitizeCode(value))} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="123456" placeholderTextColor={colors.secondary} accessibilityLabel={t('Confirmation code')} /></View>
    <Button title={t('Confirm')} busy={busy} disabled={disabled || !validCode(code)} onPress={() => onConfirm(code)} />
    <Button secondary title={seconds > 0 ? t('Resend code in {seconds} s', { seconds }) : t('Resend code')} disabled={busy || seconds > 0} onPress={() => onSend(flow.email)} />
    <Text style={styles.info}>{t('You can request a new code once every {seconds} seconds. Check your spam folder too.', { seconds: RESEND_SECONDS })}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onBack}><Text style={{ color: colors.accent, textAlign: 'center' }}>{t('Change address')}</Text></Pressable>
  </View>;
  return <View style={{ gap: 12 }}>
    <View><Text style={styles.label}>{t('Email')}</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} maxLength={254} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="name@example.com" placeholderTextColor={colors.secondary} accessibilityLabel={t('Email')} /></View>
    {!!email.trim() && !address && <Text style={styles.info}>{t('Enter an address like name@example.com. Only Latin letters are supported.')}</Text>}
    <Button title={t('Send code')} busy={busy} disabled={disabled || !address} onPress={() => { if (address) onSend(address); }} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={onBack}><Text style={{ color: colors.accent, textAlign: 'center' }}>{t('Back')}</Text></Pressable>
  </View>;
}
