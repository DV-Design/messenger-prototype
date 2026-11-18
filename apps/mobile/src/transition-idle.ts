/**
 * Screen animations in progress. Saving the encrypted history takes tens of milliseconds of
 * JavaScript on a phone; doing it while a chat slides in is what made opening feel stuck, so the
 * core waits here first (never longer than MAX_WAIT_MS).
 */
const MAX_WAIT_MS = 1000;
let running = 0;
let waiters: (() => void)[] = [];

/** Returns the function that marks this animation finished (safe to call more than once). */
export function beginTransition(): () => void {
  running++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    running = Math.max(0, running - 1);
    if (running === 0) { const ready = waiters; waiters = []; for (const resolve of ready) resolve(); }
  };
}

export function whenTransitionsIdle(): Promise<void> {
  if (running === 0) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => { waiters = waiters.filter(item => item !== finish); resolve(); }, MAX_WAIT_MS);
    const finish = () => { clearTimeout(timer); resolve(); };
    waiters.push(finish);
  });
}
