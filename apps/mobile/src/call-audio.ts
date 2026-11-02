import { useEffect, useMemo, useState } from 'react';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import { CallAudioController, type CallAudioState } from './call-audio-model';

interface NativeCallAudio {
  getCallAudioRoutes(id: string): Promise<unknown>;
  setCallAudioRoute(id: string, routeId: string): Promise<unknown>;
}
const native = NativeModules.LastCallAudio as NativeCallAudio | undefined;
const supported = Platform.OS === 'android' && !!native?.getCallAudioRoutes && !!native?.setCallAudioRoute;
const empty: CallAudioState = { callId: '', active: false, routes: [] };

export function useCallAudioRoutes(callId?: string) {
  const [state, setState] = useState<CallAudioState>(empty);
  const controller = useMemo(() => new CallAudioController({
    get: id => native!.getCallAudioRoutes(id),
    select: (id, routeId) => native!.setCallAudioRoute(id, routeId),
  }, setState), []);
  useEffect(() => {
    if (!supported) return;
    controller.setCall(callId);
    if (!callId) return;
    const events = new NativeEventEmitter(NativeModules.LastCallAudio);
    const event = events.addListener('LastCallAudioRoutes', value => controller.observe(value));
    const telecom = RNCallKeep.addEventListener('didChangeAudioRoute', value => {
      if (value.callUUID?.replaceAll('-', '') === callId) void controller.refresh();
    });
    const appState = AppState.addEventListener('change', value => { if (value === 'active') void controller.refresh(); });
    void controller.refresh();
    // Also observes Telecom availability and service startup before the first native event arrives.
    const refresh = setInterval(() => void controller.refresh(), 750);
    return () => { clearInterval(refresh); event.remove(); telecom.remove(); appState.remove(); controller.setCall(); };
  }, [callId, controller]);
  return { ...state, supported, select: (routeId: string) => controller.select(routeId) };
}
