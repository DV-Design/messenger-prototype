export type CallAudioKind = 'earpiece' | 'speaker' | 'bluetooth' | 'wired';
export interface CallAudioRoute { id: string; kind: CallAudioKind; selected: boolean }
export interface CallAudioSnapshot { callId: string; active: boolean; routes: CallAudioRoute[] }
export interface CallAudioState extends CallAudioSnapshot { pendingId?: string; error?: string }
export const audioRouteLabel: Record<CallAudioKind, string> = { earpiece: 'У телефона', speaker: 'Громкая связь', bluetooth: 'Bluetooth', wired: 'Проводная гарнитура' };
export interface CallAudioPort {
  get(id: string): Promise<unknown>;
  select(id: string, routeId: string): Promise<unknown>;
}
export function parseCallAudio(value: unknown): CallAudioSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Partial<CallAudioSnapshot>;
  if (typeof input.callId !== 'string' || !/^[a-f0-9]{32}$/.test(input.callId) || typeof input.active !== 'boolean' || !Array.isArray(input.routes)) return;
  const ids = new Set<string>();
  const routes: CallAudioRoute[] = [];
  for (const route of input.routes) {
    if (!route || typeof route.id !== 'string' || !/^\d+$/.test(route.id) || !Object.hasOwn(audioRouteLabel, route.kind) || typeof route.selected !== 'boolean' || ids.has(route.id)) continue;
    ids.add(route.id); routes.push({ id: route.id, kind: route.kind, selected: route.selected });
  }
  return { callId: input.callId, active: input.active, routes: input.active ? routes : [] };
}

/** Call-scoped requests; acknowledgements never imply that Android actually switched the route. */
export class CallAudioController {
  state: CallAudioState = { callId: '', active: false, routes: [] };
  private generation = 0;
  private observation = 0;
  private query = 0;
  private deadline = 0;
  constructor(private port: CallAudioPort, private publish: (state: CallAudioState) => void, private now = Date.now) {}
  setCall(callId = '') {
    this.generation++; this.observation++; this.query++;
    this.update({ callId, active: false, routes: [] });
  }
  private update(state: CallAudioState) { this.state = state; this.publish(state); }
  observe(value: unknown) {
    const incoming = parseCallAudio(value);
    if (!incoming || incoming.callId !== this.state.callId) return;
    this.observation++;
    let pendingId = this.state.pendingId;
    let error = this.state.error;
    if (!incoming.active) { pendingId = undefined; error = undefined; }
    if (pendingId) {
      const pending = incoming.routes.find(route => route.id === pendingId);
      if (pending?.selected) { pendingId = undefined; error = undefined; }
      else if (!pending || this.now() >= this.deadline) { pendingId = undefined; error = pending ? 'Не удалось переключить звук. Попробуйте ещё раз.' : 'Аудиоустройство отключено.'; }
    }
    this.update({ ...incoming, pendingId, error });
  }
  async refresh() {
    const { callId } = this.state;
    if (!callId) return;
    const generation = this.generation, observation = this.observation, query = ++this.query;
    try {
      const value = await this.port.get(callId);
      if (generation === this.generation && observation === this.observation && query === this.query) this.observe(value);
    } catch {
      if (generation === this.generation && observation === this.observation && query === this.query) this.update({ ...this.state, pendingId: this.now() >= this.deadline ? undefined : this.state.pendingId, error: 'Не удалось получить список аудиоустройств.' });
    }
  }
  async select(routeId: string) {
    const route = this.state.routes.find(item => item.id === routeId);
    if (!this.state.active || !route || route.selected || this.state.pendingId) return;
    const { callId } = this.state;
    const generation = this.generation, observation = this.observation;
    this.deadline = this.now() + 8000;
    this.update({ ...this.state, pendingId: routeId, error: undefined });
    try {
      const value = await this.port.select(callId, routeId);
      if (generation === this.generation && observation === this.observation) this.observe(value);
    } catch {
      if (generation === this.generation && this.state.pendingId === routeId) this.update({ ...this.state, pendingId: undefined, error: 'Не удалось переключить звук. Попробуйте ещё раз.' });
    }
  }
}
