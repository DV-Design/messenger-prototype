import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { mapsUrl, type ParsedContact, type ParsedLocation } from '../location-contact';
import { minutesSinceUpdate } from '../live-location-model';
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

/**
 * Full-screen view of one location message. It is given the message's current parse on every
 * render, so a live share moves the pin as edits arrive; the camera follows the pin until the
 * person pans the map, and the target button turns following back on.
 */
export function LocationViewer({ location, updatedAt, title, canStop, onStop, onClose, onError }: {
  location: ParsedLocation | undefined;
  updatedAt: number;
  title: string;
  canStop: boolean;
  onStop: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const map = useRef<MapView>(null);
  const [follow, setFollow] = useState(true);
  const now = useNow(location?.live ? 30000 : 0);
  const lat = location?.lat, lng = location?.lng;
  useEffect(() => {
    if (follow && lat !== undefined && lng !== undefined) map.current?.animateCamera({ center: { latitude: lat, longitude: lng } }, { duration: 600 });
  }, [follow, lat, lng]);
  function close() { setFollow(true); onClose(); }
  return <Modal visible={!!location} animationType="slide" onRequestClose={close}>
    {location && <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={[styles.chatHeader, { borderBottomWidth: 0 }]}>
        <IconButton name="close" label={t('Close')} onPress={close} />
        <Text numberOfLines={1} style={[styles.chatName, { flex: 1 }]}>{title}</Text>
        <IconButton name="locate-outline" label={t('Follow the location')} active={follow} onPress={() => setFollow(true)} />
      </View>
      <MapView ref={map} style={{ flex: 1 }} initialRegion={pointRegion(location, 0.01)} onPanDrag={() => setFollow(false)}>
        <Marker coordinate={{ latitude: location.lat, longitude: location.lng }} pinColor={location.live ? colors.danger : colors.accent} />
      </MapView>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Icon name={location.live ? 'radio' : 'location'} size={20} color={location.live ? colors.danger : colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{location.label || (location.live ? t('Live location') : t('Location'))}</Text>
            {location.live && <Text style={{ color: colors.secondary, fontSize: 13 }}>{updatedText(updatedAt, now)}</Text>}
          </View>
        </View>
        <Button title={t('Open in Google Maps')} onPress={() => void Linking.openURL(mapsUrl(location.lat, location.lng)).catch(() => onError(t('Could not open the link.')))} />
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
