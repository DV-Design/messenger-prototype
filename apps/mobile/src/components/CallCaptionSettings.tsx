import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles, colors } from '../styles';
import { t } from '../i18n';
import { Icon } from './ui';
import { CAPTION_LANGUAGES, type CaptionLanguage } from '../call-captions-model';
import { callCaptionsSupported, captionSpeechStatus, loadCaptionLanguage, saveCaptionLanguage } from '../call-captions';

export function CallCaptionSettings() {
  const [language, setLanguage] = useState<CaptionLanguage>();
  const [speech, setSpeech] = useState<{ language: CaptionLanguage; text: string }>();
  useEffect(() => { let live = true; void loadCaptionLanguage().then(value => { if (live) setLanguage(value); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!language) return;
    let live = true;
    const tag = CAPTION_LANGUAGES.find(item => item.code === language)!.tag;
    void captionSpeechStatus(language, tag).then(({ status }) => {
      if (!live) return;
      setSpeech({ language, text: status === 'ready' ? t('Speech recognition for this language is on this phone.')
        : status === 'download' || status === 'downloading' ? t('Speech recognition for this language will be downloaded when you first use captions.')
          : t('This phone has no offline speech recognition for this language. You can still read captions from the other person.') });
    });
    return () => { live = false; };
  }, [language]);
  if (!callCaptionsSupported) return null;
  return <>
    <Text style={styles.sectionTitle}>{t('CALL CAPTIONS')}</Text>
    <View style={[styles.section, styles.content, { gap: 8 }]}>
      <Text style={styles.body}>{t('Speech is recognized and translated on the phones. Words go to the other person as encrypted text and are not saved. Language packs are downloaded once from Google, which also receives usage statistics such as language names.')}</Text>
      <Text style={styles.rowName}>{t('I speak')}</Text>
      {CAPTION_LANGUAGES.map(item => <Pressable key={item.code} accessibilityRole="radio" accessibilityState={{ selected: item.code === language }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { setLanguage(item.code); void saveCaptionLanguage(item.code); }}>
        <Icon name={item.code === language ? 'radio-button-on' : 'radio-button-off'} color={colors.accent} size={22} /><Text style={styles.rowName}>{item.label}</Text>
      </Pressable>)}
      {speech?.language === language && <Text style={styles.body}>{speech.text}</Text>}
    </View>
  </>;
}
