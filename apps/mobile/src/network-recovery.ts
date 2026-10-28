export type ConnectionState = { type?: string; isConnected?: boolean; isInternetReachable?: boolean };
type Subscription = { remove(): void };

/** Recover on real reachable transitions, without treating a network gap as logout. */
export function monitorNetworkRecovery(options: {
  read(): Promise<ConnectionState>;
  listen(listener: (state: ConnectionState) => void): Subscription;
  onReachable(): void | Promise<void>;
}) {
  let active = true;
  let generation = 0;
  let signature: string | undefined;
  let running = false;
  let pending = false;
  const drain = async () => {
    if (running || !active) return;
    running = true;
    try {
      while (active && pending) {
        pending = false;
        // A failed recovery remains recoverable on the next transition/resume.
        try { await options.onReachable(); } catch { /* Core owns transport errors and retries. */ }
      }
    } finally { running = false; }
  };
  const accept = (state: ConnectionState, force: boolean) => {
    if (!active) return;
    const next = `${state.type ?? ''}:${state.isConnected ?? ''}:${state.isInternetReachable ?? ''}`;
    const changed = signature !== next;
    signature = next;
    if (state.isInternetReachable !== true || state.isConnected === false) {
      pending = false;
      return;
    }
    if (changed || force) { pending = true; void drain(); }
  };
  const read = async (force: boolean) => {
    const current = ++generation;
    try {
      const state = await options.read();
      if (active && current === generation) accept(state, force);
    } catch { /* Unknown reachability must not close an existing peer/call. */ }
  };
  const subscription = options.listen(state => { ++generation; accept(state, false); });
  void read(false);
  return {
    resume: () => read(true),
    stop: () => { active = false; ++generation; pending = false; subscription.remove(); },
  };
}
