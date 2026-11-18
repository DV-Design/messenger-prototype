import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigation } from 'expo-router';
import { beginTransition } from './transition-idle';

/**
 * False until the screen's open animation has finished. Heavy children — maps, decrypted image
 * previews — wait for it, so opening a chat starts animating at once and fills in right after,
 * the way Telegram and WhatsApp do. Outside a provider everything is ready immediately.
 */
const Settled = createContext(true);

export function useAfterTransition(): boolean { return useContext(Settled); }

/** True once this screen's open animation has finished; a timer covers a missed `transitionEnd`. */
export function useScreenSettled(fallbackMs = 700): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // Saving the history waits for this, so the animation gets the JavaScript thread to itself.
    const finished = beginTransition();
    const settle = () => { finished(); setSettled(true); };
    const unsubscribe = navigation.addListener('transitionEnd' as never, settle);
    const timer = setTimeout(settle, fallbackMs);
    return () => { unsubscribe(); clearTimeout(timer); finished(); };
  }, [navigation, fallbackMs]);
  return settled;
}

/** Hands a screen's settled state (from `useScreenSettled`) to the heavy children below it. */
export function SettledProvider({ settled, children }: { settled: boolean; children: ReactNode }) {
  return <Settled.Provider value={settled}>{children}</Settled.Provider>;
}

/** Wraps a stack screen that does not need the settled state itself. */
export function TransitionGate({ children, fallbackMs = 700 }: { children: ReactNode; fallbackMs?: number }) {
  return <SettledProvider settled={useScreenSettled(fallbackMs)}>{children}</SettledProvider>;
}
