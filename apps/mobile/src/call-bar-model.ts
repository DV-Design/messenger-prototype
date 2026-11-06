/** What the minimized call shows. The call panel owns it; the bar only reads it and asks to expand. */
export interface CallBarState { collapsed: boolean; name: string; status: string; activeSince?: number }
const hidden: CallBarState = { collapsed: false, name: '', status: '' };
let state = hidden;
const listeners = new Set<() => void>();
export function setCallBar(change: Partial<CallBarState> | null) {
  const next = change ? { ...state, ...change } : hidden;
  if (Object.keys(next).every(key => next[key as keyof CallBarState] === state[key as keyof CallBarState])) return;
  state = next; listeners.forEach(listener => listener());
}
/** The bar counts from the moment this phone saw the call become active, as Telegram's does. */
export function markCallActive(now = Date.now()) { if (state.activeSince === undefined) setCallBar({ activeSince: now }); }
export const callBarSnapshot = () => state;
export function subscribeCallBar(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const callDuration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000)), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${pad(minutes)}:${pad(seconds % 60)}`;
};
