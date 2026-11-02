export const VIDEO_CONTROLS_DELAY_MS = 5000;
interface TimerPort { set(callback: () => void, milliseconds: number): unknown; clear(timer: unknown): void }

/** The timer belongs to the current call panel, never to the media tracks. */
export class VideoControlsController {
  visible = true;
  private active = false;
  private pip = false;
  private blocked = false;
  private timer?: unknown;
  private generation = 0;
  constructor(private publish: (visible: boolean) => void, private clock: TimerPort = {
    set: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }) {}
  private cancel() { this.generation++; if (this.timer !== undefined) this.clock.clear(this.timer); this.timer = undefined; }
  private update(visible: boolean) { this.visible = visible; this.publish(visible); }
  private arm() {
    this.cancel();
    if (!this.active || this.pip || this.blocked || !this.visible) return;
    const generation = this.generation;
    this.timer = this.clock.set(() => { if (generation === this.generation) { this.timer = undefined; this.update(false); } }, VIDEO_CONTROLS_DELAY_MS);
  }
  configure(active: boolean, pip: boolean, blocked: boolean) {
    const changed = active !== this.active || pip !== this.pip || blocked !== this.blocked;
    this.active = active; this.pip = pip; this.blocked = blocked;
    if (!changed) return;
    this.update(!pip); this.arm();
  }
  interact() { if (!this.pip) { this.update(true); this.arm(); } }
  tap() {
    if (this.pip) return;
    this.update(!this.active || this.blocked || !this.visible); this.arm();
  }
  dispose() { this.cancel(); }
}
