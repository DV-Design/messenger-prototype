// Only one foreground media player owns audio focus at a time.
let stopCurrent: (() => void) | undefined;
export function claimMediaPlayback(stop: () => void) {
  if (stopCurrent !== stop) stopCurrent?.();
  stopCurrent = stop;
  return () => { if (stopCurrent === stop) stopCurrent = undefined; };
}
export function stopMediaPlayback() { stopCurrent?.(); stopCurrent = undefined; }
