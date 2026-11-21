import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface DevicePosition { lat: number; lng: number; at: number }

/**
 * The phone's own position while a map is open, so the viewer sees themselves next to the people
 * sharing (as in Telegram). It asks for location access once if it was never decided; a refusal just
 * leaves the viewer off the map. It never opens Google's "location accuracy" settings prompt: a map
 * is not a reason to change phone settings. Nothing is sent anywhere: this only draws the "You" pin.
 */
export function useDevicePosition(active: boolean): DevicePosition | undefined {
  const [position, setPosition] = useState<DevicePosition>();
  useEffect(() => {
    if (!active) return;
    let live = true;
    let subscription: Location.LocationSubscription | undefined;
    const take = (point: Location.LocationObject) => { if (live) setPosition({ lat: point.coords.latitude, lng: point.coords.longitude, at: point.timestamp || Date.now() }); };
    void (async () => {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted || !live) return;
      const last = await Location.getLastKnownPositionAsync();
      if (last) take(last);
      const watch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10, mayShowUserSettingsDialog: false }, take);
      if (live) subscription = watch; else watch.remove();
    })().catch(() => { /* No position: the map shows the others only. */ });
    return () => { live = false; subscription?.remove(); };
  }, [active]);
  return active ? position : undefined;
}
