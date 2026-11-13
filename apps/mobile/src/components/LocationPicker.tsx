import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import MapView, { Marker, type LatLng, type MapPressEvent, type MarkerDragStartEndEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { Button, Icon, IconButton } from './ui';
import { reportDenied } from '../permission-notice';
import { LIVE_DURATIONS_MIN, type LiveDurationMin } from '../live-location-model';

// Shown before the current position is known; centers on Moscow, same fallback as the rest of the app's Russian-network focus.
const DEFAULT_REGION = { latitude: 55.751244, longitude: 37.618423, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const CLOSE_REGION = { latitudeDelta: 0.01, longitudeDelta: 0.01 };

function durationLabel(minutes: LiveDurationMin): string {
  return minutes < 60 ? t('{count} min', { count: minutes }) : t('{count} h', { count: minutes / 60 });
}

/** Telegram-style: drop or drag a pin anywhere, or send the current position; live sharing is a separate, explicit step. */
export function LocationPicker({ visible, busy, onClose, onSendPoint, onStartLive }: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSendPoint: (lat: number, lng: number) => void;
  onStartLive: (lat: number, lng: number, minutes: LiveDurationMin) => void;
}) {
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const [point, setPoint] = useState<LatLng>();
  const [locating, setLocating] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);

  async function locate() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { reportDenied('location'); return; }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setPoint(next);
      map.current?.animateToRegion({ ...next, ...CLOSE_REGION }, 400);
    } catch { /* The map still works for picking a point by hand. */ }
    finally { setLocating(false); }
  }
  // Refreshes the position on open without a synchronous setState in the effect body itself
  // (the busy spinner is only for the explicit "my location" button below).
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (!permission.granted) { reportDenied('location'); return; }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => undefined);
      if (!active || !current) return;
      const next = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setPoint(next);
      map.current?.animateToRegion({ ...next, ...CLOSE_REGION }, 400);
    })();
    return () => { active = false; };
  }, [visible]);

  const move = (coordinate: LatLng) => setPoint(coordinate);
  function close() { setLiveOpen(false); setPoint(undefined); onClose(); }
  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.white }}>
      <View style={[styles.chatHeader, { borderBottomWidth: 0 }]}>
        <IconButton name="close" label={t('Close')} onPress={close} />
        <Text style={[styles.chatName, { flex: 1 }]}>{t('Location')}</Text>
        <IconButton name="locate-outline" label={t('My location')} disabled={locating} onPress={() => void locate()} />
      </View>
      <MapView ref={map} style={{ flex: 1 }} initialRegion={DEFAULT_REGION} showsUserLocation
        onPress={(event: MapPressEvent) => move(event.nativeEvent.coordinate)}>
        {point && <Marker coordinate={point} draggable onDragEnd={(event: MarkerDragStartEndEvent) => move(event.nativeEvent.coordinate)} />}
      </MapView>
      <View style={{ padding: 14, paddingBottom: 14 + insets.bottom, gap: 10 }}>
        {!liveOpen ? <>
          <Button title={t('Send this location')} disabled={busy || !point} onPress={() => { if (point) { onSendPoint(point.latitude, point.longitude); setLiveOpen(false); setPoint(undefined); } }} />
          <Pressable accessibilityRole="button" disabled={busy || !point} onPress={() => setLiveOpen(true)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11 }}>
            <Icon name="radio-outline" size={18} color={colors.accent} /><Text style={{ color: colors.accent, fontWeight: '600', fontSize: 15 }}>{t('Share live location')}</Text>
          </Pressable>
        </> : <>
          <Text style={[styles.label, { textAlign: 'center' }]}>{t('Share live location for')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {LIVE_DURATIONS_MIN.map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={busy || !point} onPress={() => { if (point) { onStartLive(point.latitude, point.longitude, minutes); setLiveOpen(false); setPoint(undefined); } }}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.outgoing, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{durationLabel(minutes)}</Text>
            </Pressable>)}
          </View>
          <Pressable accessibilityRole="button" onPress={() => setLiveOpen(false)} style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: colors.secondary }}>{t('Cancel')}</Text>
          </Pressable>
        </>}
      </View>
    </View>
  </Modal>;
}
