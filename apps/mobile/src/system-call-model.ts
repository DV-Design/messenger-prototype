import type { MessengerClient, MessengerSnapshot } from '@messenger/core';
type Manager = Pick<MessengerClient, 'getSnapshot' | 'acceptCall' | 'endCall' | 'setMuted'>;
export function nativeCallUuid(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid live call ID');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
interface NativeCallPort {
  present(uuid: string, name: string, video: boolean): Promise<boolean>;
  activate(uuid: string): void;
  end(uuid: string): void;
  startAudio(uuid: string, video: boolean): Promise<void>;
  stopAudio(uuid: string): void;
  retain(manager: Manager, uuid: string): () => void;
}
interface LiveCall { id: string; uuid: string; manager: Manager; release: () => void; timer?: ReturnType<typeof setTimeout>; answering: boolean; presented: boolean; audioStarted: boolean; }
/** Native ringing requires a current authenticated session callId, never a wake payload. */
export class SystemCallController {
  private current?: LiveCall;
  constructor(private port: NativeCallPort) {}
  update(snapshot: MessengerSnapshot, manager: Manager): void {
    const call = snapshot.activeCall;
    if (this.current && (this.current.manager !== manager || call?.session.callId !== this.current.id || call.session.callState === 'idle')) this.clear();
    if (!call?.session.callId) return;
    if (!this.current && call.session.callState === 'incoming') {
      const id = call.session.callId;
      const live: LiveCall = { id, uuid: nativeCallUuid(id), manager, release: this.port.retain(manager, nativeCallUuid(id)), answering: false, presented: false, audioStarted: false };
      this.current = live;
      live.timer = setTimeout(() => { if (this.current === live && manager.getSnapshot().activeCall?.session.callState !== 'active') { manager.endCall(); this.clear(); } }, 30_000);
      const name = snapshot.contacts.find(user => user.userId === call.peerId)?.displayName ?? 'LastCall';
      void this.port.present(live.uuid, name, !!call.session.callVideo).then(success => {
        if (this.current !== live) { if (success) this.port.end(live.uuid); return; }
        if (!success) this.clear(); else live.presented = true;
      }).catch(() => this.fail(live));
    }
    const live = this.current;
    if (live && call.session.callState === 'active') { clearTimeout(live.timer); this.port.activate(live.uuid); }
  }
  private matches(uuid: string): LiveCall | undefined {
    const live = this.current;
    return live?.uuid === uuid && live.manager.getSnapshot().activeCall?.session.callId === live.id ? live : undefined;
  }
  async answer(uuid?: string): Promise<boolean> {
    const live = uuid ? this.matches(uuid) : this.current;
    if (!live || live.manager.getSnapshot().activeCall?.session.callState !== 'incoming') return false;
    if (live.answering) return true;
    live.answering = true;
    try {
      await this.port.startAudio(live.uuid, !!live.manager.getSnapshot().activeCall?.session.callVideo);
      if (this.current !== live || live.manager.getSnapshot().activeCall?.session.callId !== live.id || live.manager.getSnapshot().activeCall?.session.callState !== 'incoming') { this.port.stopAudio(live.uuid); return true; }
      live.audioStarted = true;
      await live.manager.acceptCall();
      if (this.current === live) this.port.activate(live.uuid);
    } catch { this.fail(live); }
    return true;
  }
  end(uuid: string): void { const live = this.matches(uuid); if (live) { live.manager.endCall(); this.clear(); } }
  mute(uuid: string, muted: boolean): void { this.matches(uuid)?.manager.setMuted(muted); }
  failCurrent(uuid: string): void { const live = this.matches(uuid); if (live) this.fail(live); }
  private fail(live: LiveCall): void { if (this.current !== live) return; live.manager.endCall(); this.clear(); }
  private clear(): void {
    const live = this.current; if (!live) return; this.current = undefined;
    clearTimeout(live.timer); this.port.end(live.uuid); this.port.stopAudio(live.uuid); live.release();
  }
}

/** A real pending RN headless task keeps JS timers alive after the Expo wake task ends. */
export class CallTaskRegistry {
  private held = new Map<string, { resolve?: () => void; promise?: Promise<void> }>();
  claim(id: string): void { if (this.held.has(id)) return; if (this.held.size >= 4) throw new Error('Call runtime capacity exceeded'); this.held.set(id, {}); }
  run(id: string): Promise<void> {
    const live = this.held.get(id); if (!live) return Promise.resolve();
    live.promise ??= new Promise<void>(resolve => { live.resolve = resolve; }); return live.promise;
  }
  release(id: string): void { const live = this.held.get(id); this.held.delete(id); live?.resolve?.(); }
}
