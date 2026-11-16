import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { loadPhoneContacts } from '../contacts';
import { filterContacts, type PhoneContact } from '../contacts-model';
import { AccessDenied } from '../permission-notice-model';
import { Avatar, Icon, IconButton } from './ui';

type Load = { state: 'loading' } | { state: 'ready'; list: PhoneContact[] } | { state: 'failed'; message: string };

/** Telegram-style: the phone's contacts with a number, searchable; tapping one sends it. */
export function ContactPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (contact: PhoneContact) => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [query, setQuery] = useState('');
  // Read fresh on every open (the book may have changed), and drop the list on close so it is
  // not kept in memory longer than the picker is on screen.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void loadPhoneContacts().then(
      list => { if (active) setLoad({ state: 'ready', list }); },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof AccessDenied) { onClose(); return; }
        setLoad({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [visible, onClose]);
  const shown = useMemo(() => load.state === 'ready' ? filterContacts(load.list, query) : [], [load, query]);
  function close() { setQuery(''); setLoad({ state: 'loading' }); onClose(); }

  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={[styles.chatHeader, { borderBottomWidth: 0 }]}>
        <IconButton name="close" label={t('Close')} onPress={close} />
        <Text style={[styles.chatName, { flex: 1 }]}>{t('Choose a contact')}</Text>
      </View>
      <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} />
        <TextInput style={styles.searchInput} placeholder={t('Search contacts')} placeholderTextColor={colors.secondary} value={query} onChangeText={setQuery}
          autoCorrect={false} accessibilityLabel={t('Search contacts')} />
      </View>
      {load.state === 'loading' ? <View style={styles.empty}><ActivityIndicator color={colors.accent} /><Text style={styles.body}>{t('Loading contacts…')}</Text></View>
        : load.state === 'failed' ? <Text style={[styles.error, { margin: 16 }]}>{load.message}</Text>
          : <FlatList data={shown} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.body}>{load.list.length ? t('Nothing found') : t('No contacts with a phone number')}</Text></View>}
            renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => { setQuery(''); setLoad({ state: 'loading' }); onPick(item); }}
              style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
              <Avatar name={item.name} id={item.id} size={46} />
              <View style={styles.rowBody}>
                <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.rowText}>{item.phones[0]}{item.phones.length > 1 ? `  +${item.phones.length - 1}` : ''}</Text>
              </View>
            </Pressable>} />}
    </SafeAreaView>
  </Modal>;
}
