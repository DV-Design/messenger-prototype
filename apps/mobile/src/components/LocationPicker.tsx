import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import MapView, { type Details, type LatLng, type MapPressEvent, type PoiClickEvent, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { Icon, IconButton } from './ui';
import { reportDenied } from '../permission-notice';
import { LIVE_DURATIONS_MIN, type LiveDurationMin } from '../live-location-model';
import { accuracyMeters, addressSubtitle, addressTitle, sameSpot } from '../location-picker-model';

// Shown before the current position is known; centers on Moscow, same fallback as the rest of the app's Russian-network focus.
const DEFAULT_REGION = { latitude: 55.751244, longitude: 37.618423, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const CLOSE_DELTA = { latitudeDelta: 0.006, longitudeDelta: 0.006 };

type Fix = { coordinate: LatLng; accuracy?: number };
type Place = { coordinate: LatLng; name: string; subtitle?: string; category?: string };
type Address = { at: LatLng; title?: string; subtitle?: string };

/**
 * A fresh fix, or the last known one when that fails — e.g. the person said "No thanks" to
 * Google's Location Accuracy prompt, which makes getCurrentPositionAsync reject outright.
 */
async function currentFix(): Promise<Fix | undefined> {
  const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .catch(() => Location.getLastKnownPositionAsync().catch(() => null));
  return fix ? { coordinate: { latitude: fix.coords.latitude, longitude: fix.coords.longitude }, accuracy: fix.coords.accuracy ?? undefined } : undefined;
}

async function describe(at: LatLng): Promise<{ title?: string; subtitle?: string }> {
  const [address] = await Location.reverseGeocodeAsync(at).catch(() => []);
  const title = addressTitle(address);
  return { title, subtitle: addressSubtitle(address, title) };
}

function durationLabel(minutes: LiveDurationMin): string {
  return minutes < 60 ? t('{count} min', { count: minutes }) : t('{count} h', { count: minutes / 60 });
}

function Row({ icon, tint, title, subtitle, onPress, disabled }: { icon: Parameters<typeof Icon>[0]['name']; tint: string; title: string; subtitle?: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 11 }, pressed && { backgroundColor: '#EEF3F1' }, disabled && styles.disabled]}>
    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={21} color={colors.white} /></View>
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15.5, fontWeight: '600' }}>{title}</Text>
      {!!subtitle && <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 13 }}>{subtitle}</Text>}
    </View>
  </Pressable>;
}

/**
 * Telegram-style picker: the pin stays in the middle of the map and you move the map under it
 * (it lifts while you drag). Tapping the map moves the pin there; tapping a place on the map
 * (a shop, a station) picks that place by name. Below: send the place under the pin with its
 * address, send your current position with its accuracy, or start live sharing. The search
 * field finds an address with the phone's own geocoder.
 */
export function LocationPicker({ visible, busy, onClose, onSendPoint, onStartLive }: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSendPoint: (lat: number, lng: number, label?: string) => void;
  onStartLive: (lat: number, lng: number, minutes: LiveDurationMin) => void;
}) {
  const map = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [center, setCenter] = useState<LatLng>();
  const [dragging, setDragging] = useState(false);
  const [place, setPlace] = useState<Place>();
  const [address, setAddress] = useState<Address>();
  const [me, setMe] = useState<Fix>();
  const [locating, setLocating] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>();
  const [lookingUp, setLookingUp] = useState(false);

  const moveTo = (coordinate: LatLng, close = false) => map.current?.animateToRegion({ ...coordinate, ...(close ? CLOSE_DELTA : { latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta }) }, 350);

  async function locate(move: boolean) {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { reportDenied('location'); return; }
      const fix = await currentFix();
      if (!fix) return;
      setMe(fix);
      if (move) { setPlace(undefined); moveTo(fix.coordinate, true); }
    } finally { setLocating(false); }
  }
  // On open: find the person and centre on them, like Telegram, without a synchronous setState here.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (!permission.granted) { reportDenied('location'); return; }
      const fix = await currentFix();
      if (!active || !fix) return;
      setMe(fix);
      map.current?.animateToRegion({ ...fix.coordinate, ...CLOSE_DELTA }, 400);
    })();
    return () => { active = false; };
  }, [visible]);
  // The address under the pin, once the map has stopped for a moment.
  useEffect(() => {
    if (!center) return;
    let active = true;
    const timer = setTimeout(() => { void describe(center).then(found => { if (active) setAddress({ at: center, ...found }); }); }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [center]);

  function settled(next: Region) {
    setDragging(false); setRegion(next);
    const at = { latitude: next.latitude, longitude: next.longitude };
    setCenter(at);
    if (place && !sameSpot(place.coordinate, at, 25)) setPlace(undefined);
  }
  function moving(_next: Region, details?: Details) { if (details?.isGesture && !dragging) setDragging(true); }
  function tapMap(event: MapPressEvent) { Keyboard.dismiss(); setPlace(undefined); moveTo(event.nativeEvent.coordinate); }
  function tapPlace(event: PoiClickEvent) {
    const { coordinate, name } = event.nativeEvent;
    // Google gives "Name\nCategory"; the name is the title, the category goes with the address below it.
    const [title, ...rest] = name.split('\n').map(part => part.trim()).filter(Boolean);
    setPlace({ coordinate, name: title ?? name, category: rest.join(' · ') || undefined });
    moveTo(coordinate);
  }
  async function search() {
    const text = query.trim();
    if (!text) return;
    Keyboard.dismiss(); setLookingUp(true);
    try {
      const found = (await Location.geocodeAsync(text).catch(() => [])).slice(0, 5);
      const described = await Promise.all(found.map(async item => {
        const coordinate = { latitude: item.latitude, longitude: item.longitude };
        const { title, subtitle } = await describe(coordinate);
        return { coordinate, name: title ?? text, subtitle };
      }));
      setResults(described);
    } finally { setLookingUp(false); }
  }
  function pickResult(result: Place) { setResults(undefined); setSearching(false); setQuery(''); setPlace(result); moveTo(result.coordinate, true); }
  function close() { setLiveOpen(false); setPlace(undefined); setSearching(false); setResults(undefined); setQuery(''); onClose(); }
  function send(at: LatLng, label?: string) { onSendPoint(at.latitude, at.longitude, label); setLiveOpen(false); setPlace(undefined); }

  const pinAddress = address && center && sameSpot(address.at, center, 2) ? address : undefined;
  const selectedTitle = place?.name ?? (dragging ? t('Locating…') : pinAddress?.title ?? t('Send selected location'));
  const selectedSubtitle = place ? [place.category, place.subtitle ?? pinAddress?.title].filter(Boolean).join(' · ') || undefined : dragging ? undefined : pinAddress?.subtitle ?? (center ? `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}` : undefined);
  const meAccuracy = accuracyMeters(me?.accuracy);

  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={[styles.chatHeader, { borderBottomWidth: 0 }]}>
        <IconButton name={searching ? 'arrow-back' : 'close'} label={searching ? t('Back') : t('Close')} onPress={() => searching ? (setSearching(false), setResults(undefined), setQuery('')) : close()} />
        {searching
          ? <TextInput autoFocus value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} returnKeyType="search" placeholder={t('Search for an address')} placeholderTextColor={colors.secondary} style={[styles.searchInput, { flex: 1 }]} accessibilityLabel={t('Search for an address')} />
          : <Text style={[styles.chatName, { flex: 1 }]}>{t('Location')}</Text>}
        {searching ? <IconButton name="search" label={t('Search')} disabled={!query.trim() || lookingUp} onPress={() => void search()} />
          : <IconButton name="search" label={t('Search for an address')} onPress={() => setSearching(true)} />}
      </View>
      <>
        <View style={{ flex: 1 }}>
          <MapView ref={map} style={{ flex: 1 }} initialRegion={DEFAULT_REGION} showsUserLocation showsMyLocationButton={false} toolbarEnabled={false}
            onPress={tapMap} onPoiClick={tapPlace} onRegionChange={moving} onRegionChangeComplete={settled} />
          {/* The pin is not a map marker: it is fixed at the centre and the map moves under it. */}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ alignItems: 'center', transform: [{ translateY: dragging ? -30 : -21 }] }}>
              <Icon name="location" size={44} color={place ? colors.danger : colors.accent} />
            </View>
            <View style={{ position: 'absolute', width: dragging ? 10 : 6, height: dragging ? 4 : 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.35)' }} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('My location')} disabled={locating} onPress={() => void locate(true)}
            style={{ position: 'absolute', right: 14, bottom: 14, width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
            {locating ? <ActivityIndicator color={colors.accent} /> : <Icon name="locate" size={24} color={colors.accent} />}
          </Pressable>
          {/* Results cover the map instead of replacing it: the map keeps its camera, so picking one can fly there. */}
          {results && <ScrollView style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.white }} keyboardShouldPersistTaps="handled">
            {!results.length && <Text style={[styles.info, { padding: 20, textAlign: 'center' }]}>{t('Nothing found')}</Text>}
            {results.map((result, index) => <Row key={index} icon="location" tint={colors.accent} title={result.name} subtitle={result.subtitle} onPress={() => pickResult(result)} />)}
          </ScrollView>}
          {lookingUp && <ActivityIndicator color={colors.accent} style={{ position: 'absolute', top: 20, alignSelf: 'center' }} />}
        </View>
        {!liveOpen ? <View style={{ paddingVertical: 6 }}>
          <Row icon="location" tint={place ? colors.danger : colors.accent} title={selectedTitle} subtitle={selectedSubtitle} disabled={busy || !center || dragging}
            onPress={() => center && send(place?.coordinate ?? center, place?.name ?? pinAddress?.title)} />
          {me && <Row icon="navigate" tint={colors.blue} title={t('Send my current location')} subtitle={meAccuracy ? t('Accurate to {meters} m', { meters: meAccuracy }) : undefined} disabled={busy}
            onPress={() => send(me.coordinate, t('My location'))} />}
          <Row icon="radio" tint={colors.danger} title={t('Share live location')} subtitle={t('Updated in real time as you move')} disabled={busy || (!me && !center)} onPress={() => setLiveOpen(true)} />
        </View> : <View style={{ padding: 14, gap: 10 }}>
          <Text style={[styles.label, { textAlign: 'center' }]}>{t('Share live location for')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {LIVE_DURATIONS_MIN.map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={busy} onPress={() => { const at = me?.coordinate ?? center; if (at) { onStartLive(at.latitude, at.longitude, minutes); setLiveOpen(false); } }}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.outgoing, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{durationLabel(minutes)}</Text>
            </Pressable>)}
          </View>
          <Pressable accessibilityRole="button" onPress={() => setLiveOpen(false)} style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.secondary }}>{t('Cancel')}</Text>
          </Pressable>
        </View>}
      </>
    </SafeAreaView>
  </Modal>;
}
