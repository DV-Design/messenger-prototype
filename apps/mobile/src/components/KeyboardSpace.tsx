import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View } from 'react-native';

/**
 * Keeps the message bar above the keyboard. On Android React Native's KeyboardAvoidingView
 * (behavior "height") remembers its height from the first layout; when a strip above it changed
 * afterwards (the delivery notice growing to three lines, a translation strip), the bar slid under
 * the keyboard as the field grew. Here the overlap is measured each time from where this area and
 * the keyboard actually are, so it is right whether or not the window itself was resized.
 */
export function KeyboardSpace({ children, iosOffset }: { children: ReactNode; iosOffset: number }) {
  if (Platform.OS === 'ios') return <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={iosOffset}>{children}</KeyboardAvoidingView>;
  return <AndroidKeyboardSpace>{children}</AndroidKeyboardSpace>;
}

function AndroidKeyboardSpace({ children }: { children: ReactNode }) {
  const area = useRef<ComponentRef<typeof View>>(null);
  const keyboardTop = useRef<number | null>(null);
  const [space, setSpace] = useState(0);
  const measure = useCallback(() => {
    const top = keyboardTop.current;
    if (top === null) { setSpace(0); return; }
    area.current?.measureInWindow((_x, y, _width, height) => {
      if (keyboardTop.current === null) return;
      setSpace(Math.max(0, Math.round(y + height - top)));
    });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => { keyboardTop.current = event.endCoordinates.screenY; measure(); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = null; setSpace(0); });
    if (Keyboard.isVisible()) { const metrics = Keyboard.metrics(); if (metrics) { keyboardTop.current = metrics.screenY; measure(); } }
    return () => { show.remove(); hide.remove(); };
  }, [measure]);
  // The padding is inside the measured area, so changing it never moves the area itself.
  return <View ref={area} onLayout={measure} style={{ flex: 1, paddingBottom: space }}>{children}</View>;
}
