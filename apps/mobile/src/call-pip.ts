import { t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { CallPipObserver, emptyCallPip, type CallPipSnapshot } from './call-pip-model';

export const CALL_PIP_CHANGED = 'LastCallPipChanged';

interface LastCallPipNative {
  configure(callId: string, enabled: boolean, width: number, height: number): Promise<unknown>;
  enter(callId: string): Promise<unknown>;
  clear(callId: string): void;
  getState(): Promise<unknown>;
}

/** Android-only by design: the iOS target has no PiP bridge and must not pretend it does. */
export function nativeCallPip(): LastCallPipNative | undefined {
  if (Platform.OS !== 'android') return undefined;
  return (NativeModules as Record<string, unknown>).LastCallPip as LastCallPipNative | undefined;
}

export interface CallPipHook {
  snapshot: CallPipSnapshot;
  error: string;
  minimize(): Promise<boolean>;
  clear(): void;
}

/**
 * Keeps one native PiP owner for the current call. Event subscription is installed
 * before configure so an auto-enter/close transition can never be missed.
 */
export function useCallPip(options: {
  callId?: string;
  enabled: boolean;
  width: number;
  height: number;
  onClose: () => void;
}): CallPipHook {
  const { callId, enabled, width, height, onClose } = options;
  const [snapshot, setSnapshot] = useState<CallPipSnapshot>(emptyCallPip);
  // A failure stays visible until the next native snapshot: once PiP state
  // moves on, the problem is stale and must not resurface when PiP is closed.
  const [failure, setFailure] = useState<{ text: string; seen: CallPipSnapshot }>();
  const error = failure && failure.seen === snapshot ? failure.text : '';
  const observer = useRef<CallPipObserver | undefined>(undefined);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!callId) return;
    const native = nativeCallPip();
    const current = new CallPipObserver(
      setSnapshot,
      () => { close.current(); },
    );
    observer.current = current;
    const subscription = native
      ? new NativeEventEmitter(native as never).addListener(CALL_PIP_CHANGED, (value: unknown) => current.observe(value))
      : undefined;
    current.setCall(callId);
    if (native) {
      void current.request(() => native.getState()).catch(() => {
        setFailure({ text: t('Picture-in-picture state is unavailable'), seen: current.state });
      });
    }
    return () => {
      subscription?.remove();
      if (observer.current === current) observer.current = undefined;
      // Native ignores a mismatched owner, so this can never clear a newer call.
      native?.clear(callId);
    };
  }, [callId]);

  useEffect(() => {
    const native = nativeCallPip();
    const current = observer.current;
    if (!native || !callId || !current) return;
    if (!enabled) {
      native.clear(callId);
      return;
    }
    void current.request(() => native.configure(callId, true, width, height)).catch(() => {
      setFailure({ text: t('Picture-in-picture is unavailable: check permission in settings'), seen: current.state });
    });
  }, [callId, enabled, width, height]);

  async function minimize() {
    const native = nativeCallPip();
    const current = observer.current;
    if (!native || !callId || !current || !snapshot.supported || !snapshot.allowed) {
      setFailure({ text: snapshot.supported === false ? t('Picture-in-picture is not supported on this device') : t('Picture-in-picture is unavailable: check permission in settings'), seen: current?.state ?? snapshot });
      return false;
    }
    try {
      await current.request(() => native.enter(callId));
      return true;
    } catch {
      setFailure({ text: t('Could not open picture-in-picture'), seen: current.state });
      return false;
    }
  }

  function clear() {
    nativeCallPip()?.clear(callId ?? '');
  }

  return { snapshot: callId ? snapshot : emptyCallPip, error, minimize, clear };
}
