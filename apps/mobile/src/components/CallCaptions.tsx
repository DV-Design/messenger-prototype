import { Pressable, Text, View } from 'react-native';
import { colors } from '../styles';
import { t } from '../i18n';
import type { CaptionsView } from '../call-captions-model';

function notice(view: CaptionsView): string {
  if (!view.enabled) return '';
  if (!view.peerEnabled) return t('Waiting for the other person to turn on captions…');
  if (view.speech === 'unavailable') return t('This phone cannot recognize your speech offline, so the other person will not see your words.');
  if (view.speech === 'downloading') return t('Getting speech recognition ready…');
  if (view.peerSpeech === 'unavailable') return t('The other phone cannot recognize speech offline, so captions from it will not appear.');
  if (view.translation === 'preparing') return t('Downloading the translation language, about 30 MB…');
  if (view.translation === 'failed') return t('Could not download the translation. Showing the original words.');
  if (!view.lines.length) return t('Captions are on. Speech is recognized on each phone.');
  return '';
}

export function CallCaptions({ view, onEnable, onDecline }: { view: CaptionsView; onEnable: () => void; onDecline: () => void }) {
  const message = notice(view);
  if (view.asked) return <View style={{ alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 14, padding: 12, gap: 10 }}>
    <Text accessibilityRole="alert" style={{ color: colors.white, fontSize: 15, lineHeight: 21 }}>{t('The other person wants captions with translation. Your speech will be recognized on this phone and sent to them as encrypted text.')}</Text>
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={onDecline} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}><Text style={{ color: colors.white, fontSize: 15 }}>{t('Not now')}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onEnable} style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 10 }}><Text style={{ color: colors.white, fontSize: 15, fontWeight: '600' }}>{t('Turn on')}</Text></Pressable>
    </View>
  </View>;
  if (!view.enabled) return null;
  return <View accessibilityLiveRegion="polite" pointerEvents="none" style={{ alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 14, padding: 12, gap: 6 }}>
    {view.lines.map((line, index) => {
      const latest = index === view.lines.length - 1;
      return <View key={line.segment} style={{ opacity: latest ? 1 : 0.65 }}>
        <Text numberOfLines={latest ? 4 : 2} style={{ color: colors.white, fontSize: latest ? 19 : 16, lineHeight: latest ? 25 : 21, fontWeight: '500' }}>{line.text}</Text>
        {line.translated && line.original !== line.text && latest && <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 18 }}>{line.original}</Text>}
      </View>;
    })}
    {!!message && <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 20 }}>{message}</Text>}
    {!!view.own && <Text numberOfLines={1} ellipsizeMode="head" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 18 }}>{t('You: {text}', { text: view.own })}</Text>}
  </View>;
}
