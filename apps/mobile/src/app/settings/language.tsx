import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MenuGroup, MenuRow, SettingsPage } from '../../components/ui';
import { CAPTION_LANGUAGES, captionSpeechNote, type CaptionLanguage } from '../../call-captions-model';
import { callCaptionsSupported, captionSpeechStatus } from '../../call-captions';
import { chatTranslationSupported } from '../../chat-translation';
import { setMyLanguage, useMyLanguage } from '../../my-language';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function LanguageSettings() {
  const language = useMyLanguage();
  const [speech, setSpeech] = useState<{ language: CaptionLanguage; text: string }>();
  useEffect(() => {
    if (!callCaptionsSupported) return;
    let live = true;
    void captionSpeechStatus(language.code, language.tag).then(({ status }) => {
      if (!live) return;
      setSpeech({ language: language.code, text: status === 'ready' ? t('Speech recognition for this language is on this phone.')
        : status === 'download' || status === 'downloading' ? t('Speech recognition for this language will be downloaded when you first use captions.')
          : t('This phone has no offline speech recognition for this language. You can still read captions from the other person.') });
    });
    return () => { live = false; };
  }, [language.code, language.tag]);
  const note = captionSpeechNote(speech, language.code);
  return <SettingsPage title={t('Language and translation')}>
    <View style={[styles.content, { paddingBottom: 0 }]}>
      <Text style={styles.body}>{[chatTranslationSupported ? t('Chats are translated into this language when you tap Translate in a chat.') : '', callCaptionsSupported ? t('In calls, your speech is recognized in this language for captions.') : ''].filter(Boolean).join(' ')}</Text>
    </View>
    <MenuGroup title={t('MY LANGUAGE')}>{CAPTION_LANGUAGES.map(item => <MenuRow key={item.code} icon={item.code === language.code ? 'radio-button-on' : 'radio-button-off'} title={item.label}
      onPress={() => void setMyLanguage(item.code)} />)}</MenuGroup>
    <View style={[styles.content, { gap: 8 }]}>
      {!!note && <Text style={styles.info}>{note}</Text>}
      <Text style={styles.info}>{t('Translation and speech recognition run on the phone. Language packs are downloaded once from Google, which also receives usage statistics such as language names. Words go to the other person as encrypted text and are not saved.')}</Text>
    </View>
  </SettingsPage>;
}
