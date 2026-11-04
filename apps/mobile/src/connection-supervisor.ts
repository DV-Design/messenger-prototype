/** Foreground recovery for connection states that core deliberately leaves stopped. */
export type ConnectionInput = {
  foreground: boolean;
  retired: boolean;
  hasProfile: boolean;
  hasIdentity: boolean;
  registration: 'checking' | 'unregistered' | 'unavailable' | 'bound';
  status: 'idle' | 'connecting' | 'online' | 'offline' | 'error';
  error?: string;
};
export type ConnectionAction = 'none' | 'reconnect' | 'check-registration';

// Retrying cannot fix these: the user must act, or local data must not be overwritten.
const NEEDS_USER = /^(account-moved|username-taken|email-required|email-taken)\b|Encrypted local state is invalid/;
const TRANSIENT = /^(auth-failed|auth-expired|session-replaced|device-already-registered)\b|^Directory |^Email connection|This identity connected|already registered on this server|Network request failed|WebSocket|timed out/i;

export const connectionNeedsUser = (error?: string): boolean => !!error && NEEDS_USER.test(error);
/** The app retries these itself, so showing their raw text only alarms the user. */
export const isTransientConnectionError = (error?: string): boolean => !!error && !NEEDS_USER.test(error) && TRANSIENT.test(error);

export function connectionAction(input: ConnectionInput): ConnectionAction {
  if (!input.foreground || input.retired || !input.hasIdentity) return 'none';
  if (!input.hasProfile) return input.registration === 'unavailable' ? 'check-registration' : 'none';
  // 'idle' means boot has not connected yet; retrying here would race it for the manager.
  if (input.status === 'online' || input.status === 'connecting' || input.status === 'idle') return 'none';
  return input.status === 'error' && connectionNeedsUser(input.error) ? 'none' : 'reconnect';
}

export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

interface Scheduler { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }
const timers: Scheduler = { set: (callback, delay) => setTimeout(callback, delay), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** One bounded retry loop: calling poke() on every state change never stacks timers. */
export class ConnectionSupervisor {
  private timer: unknown;
  private attempt = 0;
  private running = false;
  constructor(private readonly options: { read(): ConnectionInput; reconnect(): Promise<void>; checkRegistration(): Promise<void>; scheduler?: Scheduler }) {}
  private get scheduler() { return this.options.scheduler ?? timers; }
  poke(): void {
    const action = connectionAction(this.options.read());
    if (action === 'none') {
      if (this.timer !== undefined) { this.scheduler.clear(this.timer); this.timer = undefined; }
      if (this.options.read().status === 'online') this.attempt = 0;
      return;
    }
    if (this.timer !== undefined || this.running) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.timer = this.scheduler.set(() => { this.timer = undefined; void this.run(); }, delay);
  }
  /** A return to the app should not sit out a long backoff from before it was hidden. */
  resume(): void {
    this.attempt = 0;
    if (this.timer !== undefined) { this.scheduler.clear(this.timer); this.timer = undefined; }
    this.poke();
  }
  stop(): void { if (this.timer !== undefined) { this.scheduler.clear(this.timer); this.timer = undefined; } }
  private async run(): Promise<void> {
    const action = connectionAction(this.options.read());
    if (action === 'none') return;
    this.running = true;
    try { await (action === 'reconnect' ? this.options.reconnect() : this.options.checkRegistration()); }
    catch { /* The next pass retries from the state core reports. */ }
    finally { this.running = false; this.poke(); }
  }
}
