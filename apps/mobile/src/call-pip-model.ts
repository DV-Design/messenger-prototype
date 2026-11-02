export interface CallPipSnapshot { callId: string; active: boolean; supported: boolean; allowed: boolean; transitioning: boolean; closed: boolean }
export const emptyCallPip: CallPipSnapshot = { callId: '', active: false, supported: false, allowed: false, transitioning: false, closed: false };
export function parseCallPip(value: unknown): CallPipSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Partial<CallPipSnapshot>;
  if (typeof input.callId !== 'string' || !/^([a-f0-9]{32})?$/.test(input.callId) || typeof input.active !== 'boolean' || typeof input.supported !== 'boolean' || typeof input.allowed !== 'boolean') return;
  if (input.transitioning !== undefined && typeof input.transitioning !== 'boolean') return;
  if (input.closed !== undefined && typeof input.closed !== 'boolean') return;
  return { callId: input.callId, active: input.active, supported: input.supported, allowed: input.allowed, transitioning: !!input.transitioning, closed: !!input.closed };
}
/** Native events take precedence over older query/enter/configure replies. */
export class CallPipObserver {
  state = emptyCallPip;
  private generation = 0;
  private observation = 0;
  private dismissed = false;
  constructor(private publish: (value: CallPipSnapshot) => void, private close: () => void) {}
  setCall(callId = '') { this.generation++; this.observation++; this.dismissed = false; this.state = { ...emptyCallPip, callId }; this.publish(this.state); }
  observe(value: unknown) {
    const incoming = parseCallPip(value);
    if (!incoming || incoming.callId !== this.state.callId || !incoming.callId) return;
    this.observation++; this.state = incoming; this.publish(incoming);
    if (incoming.closed && !this.dismissed) { this.dismissed = true; this.close(); }
  }
  async request(operation: () => Promise<unknown>) {
    const generation = this.generation, observation = this.observation;
    const result = await operation();
    if (generation === this.generation && observation === this.observation) this.observe(result);
    return result;
  }
}

/** A native close may end only the call id that is still live in the client snapshot. */
export function ownsLiveCall(liveCallId: string | undefined, callId: string | undefined): callId is string {
  return !!callId && liveCallId === callId;
}
