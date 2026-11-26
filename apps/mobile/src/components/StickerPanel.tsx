import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { NOTO_STICKERS } from '../stickers';
import { klipyEnabled, klipyList, type KlipyItem, type KlipyKind } from '../klipy';
import { colors, styles } from '../styles';
import { t } from '../i18n';

const PANEL_HEIGHT = 300;

/**
 * Stickers and GIFs, opened from the message bar like Telegram's panel. Built-in stickers are
 * animated Noto emoji and need no network; GIF search and more stickers come from KLIPY.
 */
export function StickerPanel({ onSticker, onKlipy }: { onSticker: (emoji: string) => void; onKlipy: (kind: KlipyKind, item: KlipyItem) => void }) {
  const [tab, setTab] = useState<'stickers' | 'gifs'>('stickers');
  return <View style={{ height: PANEL_HEIGHT, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line }}>
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingTop: 8 }}>
      {(['stickers', 'gifs'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)}
        style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: tab === value ? colors.accent : '#EEF2F1' }}>
        <Text style={{ color: tab === value ? colors.white : colors.text, fontWeight: '600' }}>{value === 'stickers' ? t('Stickers') : t('GIF')}</Text>
      </Pressable>)}
    </View>
    {tab === 'stickers' ? <Stickers onSticker={onSticker} onKlipy={item => onKlipy('stickers', item)} /> : <KlipyGrid kind="gifs" onPick={item => onKlipy('gifs', item)} />}
  </View>;
}

function Stickers({ onSticker, onKlipy }: { onSticker: (emoji: string) => void; onKlipy: (item: KlipyItem) => void }) {
  const [query, setQuery] = useState('');
  return <View style={{ flex: 1 }}>
    {klipyEnabled && <SearchField value={query} onChange={setQuery} placeholder={t('Search stickers')} />}
    {query.trim() ? <KlipyGrid kind="stickers" query={query} onPick={onKlipy} /> : <FlatList data={NOTO_STICKERS} keyExtractor={item => item.code} numColumns={6} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 8 }} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={t('Send sticker {emoji}', { emoji: item.emoji })} onPress={() => onSticker(item.emoji)}
        style={({ pressed }) => [{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, pressed && { backgroundColor: '#EEF2F1' }]}>
        <Text style={{ fontSize: 34 }}>{item.emoji}</Text>
      </Pressable>} />}
  </View>;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.secondary} accessibilityLabel={placeholder} maxLength={100}
    style={{ marginHorizontal: 10, marginTop: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#F1F4F6', color: colors.text, fontSize: 15 }} />;
}

function KlipyGrid({ kind, query: fixedQuery, onPick }: { kind: KlipyKind; query?: string; onPick: (item: KlipyItem) => void }) {
  const [typed, setTyped] = useState('');
  const query = fixedQuery ?? typed;
  const [state, setState] = useState<{ key: string; items: KlipyItem[]; error: boolean; done: boolean }>({ key: '', items: [], error: false, done: false });
  const { width } = useWindowDimensions();
  const key = `${kind}:${query.trim()}`;
  useEffect(() => {
    if (!klipyEnabled) return;
    const controller = new AbortController();
    // Typing waits a moment so every keystroke is not a request.
    const timer = setTimeout(() => {
      klipyList(kind, query, 1, controller.signal)
        .then(result => setState({ key, items: result.items, error: false, done: true }))
        .catch(() => { if (!controller.signal.aborted) setState({ key, items: [], error: true, done: true }); });
    }, query.trim() ? 350 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, query, key]);
  if (!klipyEnabled) return <Text style={[styles.info, { padding: 16, textAlign: 'center' }]}>{t('GIF search is not set up in this version yet.')}</Text>;
  const current = state.key === key ? state : undefined;
  const columns = kind === 'stickers' ? 4 : 3;
  const tile = (width - 16) / columns;
  return <View style={{ flex: 1 }}>
    {fixedQuery === undefined && <SearchField value={typed} onChange={setTyped} placeholder={t('Search GIFs')} />}
    {!current?.done ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />
      : current.error ? <Text style={[styles.info, { padding: 16, textAlign: 'center' }]}>{t('Could not load. Check the connection and try again.')}</Text>
        : !current.items.length ? <Text style={[styles.info, { padding: 16, textAlign: 'center' }]}>{t('Nothing found')}</Text>
          : <FlatList data={current.items} keyExtractor={item => item.slug} numColumns={columns} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 8 }}
            renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.title || (kind === 'gifs' ? t('GIF') : t('Sticker'))} onPress={() => onPick(item)} style={{ width: tile, height: tile, padding: 2 }}>
              <Image source={{ uri: item.preview.url }} style={{ flex: 1, borderRadius: 8 }} contentFit={kind === 'stickers' ? 'contain' : 'cover'} autoplay recyclingKey={item.slug} />
            </Pressable>} />}
    {/* KLIPY's terms ask for its attribution where its search is shown. */}
    <Text style={{ textAlign: 'center', color: colors.secondary, fontSize: 11, paddingBottom: 4 }}>{t('Powered by KLIPY')}</Text>
  </View>;
}
