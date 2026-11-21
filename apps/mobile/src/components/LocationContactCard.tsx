import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { intlLocale, t } from '../i18n';
import { colors, styles } from '../styles';
import { mapsUrl, type ParsedContact, type ParsedLocation } from '../location-contact';
import { minutesSinceUpdate } from '../live-location-model';
import { distanceFrom, mapPins, type MapMessage, type MapPin } from '../location-map-model';
import type { DevicePosition } from '../device-position';
import { Avatar, Button, Icon, IconButton, time } from './ui';
import { useAfterTransition } from '../after-transition';

const CARD = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 2, minWidth: 190, maxWidth: 230 };

/** Re-renders every `ms` so "updated N min ago" stays true without new messages; 0 disables it. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ms) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function updatedText(updatedAt: number, now: number): string {
  const minutes = minutesSinceUpdate(updatedAt, now);
  if (minutes < 1) return t('updated just now');
  if (minutes < 60) return t('updated {count} min ago', { count: minutes });
  return t('updated at {time}', { time: time(updatedAt) });
}

const pointRegion = (location: ParsedLocation, delta: number) => ({ latitude: location.lat, longitude: location.lng, latitudeDelta: delta, longitudeDelta: delta });

/**
 * Telegram-style bubble: a small static map with the pin, then title and status. A live share
 * is one message the sender keeps editing, so this re-renders with the new point on every edit.
 */
export function LocationCard({ location, updatedAt, onOpen }: { location: ParsedLocation; updatedAt: number; onOpen: () => void }) {
  const now = useNow(location.live ? 30000 : 0);
  // A lite map is a native view per bubble; it waits until the chat has finished opening.
  const mapReady = useAfterTransition();
  return <Pressable accessibilityRole="button" accessibilityLabel={location.live ? t('Live location') : t('Location')} accessibilityHint={t('Opens the map')} onPress={onOpen} style={{ width: 236, gap: 7 }}>
    <View pointerEvents="none" style={{ height: 128, borderRadius: 12, overflow: 'hidden', backgroundColor: '#E4ECE8', alignItems: 'center', justifyContent: 'center' }}>
      {!mapReady ? <Icon name="location" size={30} color={location.live ? colors.danger : colors.accent} /> : <MapView liteMode style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} region={pointRegion(location, 0.006)} toolbarEnabled={false}
        scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}>
        <Marker coordinate={{ latitude: location.lat, longitude: location.lng }} pinColor={location.live ? colors.danger : colors.accent} />
      </MapView>}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={location.live ? 'radio' : 'location'} size={18} color={location.live ? colors.danger : colors.accent} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{location.label || (location.live ? t('Live location') : t('Location'))}</Text>
        {location.live && <Text style={{ color: colors.secondary, fontSize: 12.5 }}>{updatedText(updatedAt, now)}</Text>}
      </View>
    </View>
  </Pressable>;
}

/** "350 m" or "1,2 km" in the app's language. */
function distanceText(meters: number): string {
  if (meters < 1000) return t('{count} m away', { count: Math.max(10, Math.round(meters / 10) * 10) });
  return t('{count} km away', { count: new Intl.NumberFormat(intlLocale, { maximumFractionDigits: meters < 10000 ? 1 : 0 }).format(meters / 1000) });
}

/** Red while sharing live, blue for where the viewer is now, green for a sent place. */
const ringColor = (pin: MapPin) => pin.kind === 'live' ? colors.danger : pin.kind === 'device' ? colors.blue : colors.accent;

/** A person on the map: their avatar in a coloured ring (red while sharing live) and their name under it. */
function PersonMarker({ pin, name, avatarName, onPress }: { pin: MapPin; name: string; avatarName: string; onPress: () => void }) {
  const label = pin.kind === 'place' && pin.label ? pin.label : name;
  // Android draws a custom marker as a bitmap; let it render once, then stop re-capturing it.
  const [tracks, setTracks] = useState(true);
  useEffect(() => { const timer = setTimeout(() => setTracks(false), 800); return () => clearTimeout(timer); }, []);
  const ring = ringColor(pin);
  return <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} anchor={{ x: 0.5, y: 0.32 }} tracksViewChanges={tracks} onPress={onPress} zIndex={pin.kind === 'device' ? 1 : 2}>
    <View style={{ alignItems: 'center' }}>
      <View style={{ padding: 2, borderRadius: 26, backgroundColor: ring }}><View style={{ padding: 1, borderRadius: 24, backgroundColor: colors.white }}><Avatar name={avatarName} id={pin.ownerId} size={40} /></View></View>
      <View style={{ marginTop: 3, maxWidth: 140, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 1, borderColor: colors.line }}>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{label}</Text>
      </View>
    </View>
  </Marker>;
}

/**
 * Full-screen chat map, like Telegram's: everyone sharing a live location in the chat, the tapped
 * point, and the viewer themselves, each a labelled pin; a list below with when each point was
 * updated and how far it is. Pins move as edits arrive; the camera keeps everyone in view until the
 * person pans, and the target button brings that back.
 */
export function LocationViewer({ messages, focusId, focus, ownId, ownName, device, unwrap, nameOf, title, isOwnLiveShare, onStop, onClose, onError }: {
  messages: readonly MapMessage[];
  focusId: string | undefined;
  /** The tapped location, for its label and the Google Maps link. */
  focus: ParsedLocation | undefined;
  ownId: string;
  /** The viewer's display name, for the initials in their own avatar (their label says "You"). */
  ownName: string;
  device: DevicePosition | undefined;
  unwrap: (text: string) => string;
  /** The person's name, "You" for the viewer. */
  nameOf: (userId: string) => string;
  title: string;
  /** True for the message this phone's running share keeps editing. */
  isOwnLiveShare: (messageId: string) => boolean;
  onStop: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const map = useRef<MapView>(null);
  const [follow, setFollow] = useState(true);
  const now = useNow(focusId ? 30000 : 0);
  const pins = focusId ? mapPins(messages, focusId, ownId, device, now, unwrap) : [];
  const canStop = pins.some(pin => pin.self && pin.kind === 'live' && !!pin.messageId && isOwnLiveShare(pin.messageId));
  const self = pins.find(pin => pin.self);
  const visible = !!focus && pins.length > 0;
  // Re-frame only when a point actually moved, not on every render.
  const frameKey = pins.map(pin => `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (!follow || !visible) return;
    const coordinates = frameKey.split('|').map(part => { const [lat, lng] = part.split(',').map(Number); return { latitude: lat!, longitude: lng! }; });
    const timer = setTimeout(() => {
      if (coordinates.length > 1) map.current?.fitToCoordinates(coordinates, { edgePadding: { top: 90, right: 70, bottom: 70, left: 70 }, animated: true });
      else if (coordinates[0]) map.current?.animateCamera({ center: coordinates[0], zoom: 16 }, { duration: 600 });
    }, 250);
    return () => clearTimeout(timer);
  }, [follow, visible, frameKey]);
  function close() { setFollow(true); onClose(); }
  function show(pin: MapPin) { setFollow(false); map.current?.animateCamera({ center: { latitude: pin.lat, longitude: pin.lng }, zoom: 17 }, { duration: 500 }); }
  const first = pins.find(pin => pin.messageId === focusId) ?? pins[0];
  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    {visible && first && <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={[styles.chatHeader, { borderBottomWidth: 0 }]}>
        <IconButton name="close" label={t('Close')} onPress={close} />
        <Text numberOfLines={1} style={[styles.chatName, { flex: 1 }]}>{title}</Text>
        <IconButton name="locate-outline" label={t('Show everyone')} active={follow} onPress={() => setFollow(true)} />
      </View>
      <MapView ref={map} style={{ flex: 1 }} initialRegion={pointRegion({ lat: first.lat, lng: first.lng, live: first.kind === 'live', label: '' }, 0.01)} onPanDrag={() => setFollow(false)} toolbarEnabled={false}>
        {pins.map(pin => <PersonMarker key={pin.key} pin={pin} name={nameOf(pin.ownerId)} avatarName={pin.ownerId === ownId ? ownName : nameOf(pin.ownerId)} onPress={() => show(pin)} />)}
      </MapView>
      <View style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12, gap: 4 }}>
        {pins.map(pin => {
          const distance = distanceFrom(self, pin);
          const name = nameOf(pin.ownerId);
          const status = pin.kind === 'live' ? (pin.self ? t('You are sharing · {updated}', { updated: updatedText(pin.updatedAt, now) }) : t('Sharing live · {updated}', { updated: updatedText(pin.updatedAt, now) }))
            : pin.kind === 'device' ? t('Your location now') : pin.label || t('Location');
          return <Pressable key={pin.key} accessibilityRole="button" accessibilityLabel={`${name}, ${status}`} accessibilityHint={t('Shows on the map')} onPress={() => show(pin)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 }, pressed && styles.pressed]}>
            <View style={{ padding: 2, borderRadius: 20, backgroundColor: ringColor(pin) }}><Avatar name={pin.ownerId === ownId ? ownName : name} id={pin.ownerId} size={34} /></View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{name}</Text>
              <Text numberOfLines={1} style={{ color: pin.kind === 'live' ? colors.danger : colors.secondary, fontSize: 13 }}>{status}</Text>
            </View>
            {distance !== undefined && <Text style={{ color: colors.secondary, fontSize: 13 }}>{distanceText(distance)}</Text>}
          </Pressable>;
        })}
        {focus && <Button secondary title={t('Open in Google Maps')} onPress={() => void Linking.openURL(mapsUrl(focus.lat, focus.lng)).catch(() => onError(t('Could not open the link.')))} />}
        {canStop && <Pressable accessibilityRole="button" onPress={onStop} style={{ paddingVertical: 9, alignItems: 'center' }}>
          <Text style={{ color: colors.danger, fontWeight: '600', fontSize: 15 }}>{t('Stop sharing')}</Text>
        </Pressable>}
      </View>
    </SafeAreaView>}
  </Modal>;
}

export function ContactCard({ contact }: { contact: ParsedContact }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={t('Call {name}', { name: contact.name })} style={CARD}
    onPress={() => void Linking.openURL(`tel:${contact.phones[0]}`)}>
    <Avatar name={contact.name} size={40} />
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{contact.name}</Text>
      <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 12.5 }}>{contact.phones[0]}</Text>
    </View>
    <Icon name="call-outline" size={19} color={colors.accent} />
  </Pressable>;
}
