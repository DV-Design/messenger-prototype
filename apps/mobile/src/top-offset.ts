import { createContext, useContext } from 'react';

/**
 * How far the strips at the top of the app (the call bar, the live location bar) push every screen
 * down, in points. KeyboardAvoidingView measures itself from its parent, not from the top of the
 * screen, so without this it misses the keyboard by the strips' height and the message field ends
 * up under the keyboard.
 */
export const TopOffset = createContext(0);

export function useTopOffset(): number {
  return useContext(TopOffset);
}

/** A strip is its top inset (status bar) plus a 34 pt row. */
export const TOP_STRIP_HEIGHT = 34;
