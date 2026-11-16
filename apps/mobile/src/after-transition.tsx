import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigation } from 'expo-router';

/**
 * False until the screen's open animation has finished. Heavy children — maps, decrypted image
 * previews — wait for it, so opening a chat starts animating at once and fills in right after,
 * the way Telegram and WhatsApp do. Outside a provider everything is ready immediately.
 */
const Settled = createContext(true);

export function useAfterTransition(): boolean { return useContext(Settled); }

/** Wraps a stack screen; a timer covers a missed `transitionEnd` (e.g. opened without animation). */
export function TransitionGate({ children, fallbackMs = 700 }: { children: ReactNode; fallbackMs?: number }) {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('transitionEnd' as never, () => setSettled(true));
    const timer = setTimeout(() => setSettled(true), fallbackMs);
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [navigation, fallbackMs]);
  return <Settled.Provider value={settled}>{children}</Settled.Provider>;
}
