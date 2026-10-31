import type { MessengerClient, MessengerSnapshot } from '@messenger/core';
type Manager = Pick<MessengerClient, 'getSnapshot' | 'acceptCall' | 'endCall' | 'setMuted'>;
export function nativeCallUuid(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid live call ID');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
const nativeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Android 8+ is the first version with self-managed ConnectionService. */
export const SELF_MANAGED_MIN_API = 26;
export function nativeCallMode(apiLevel: number): 'self-managed' | 'in-app' {
  return Number.isFinite(apiLevel) && apiLevel >= SELF_MANAGED_MIN_API ? 'self-managed' : 'in-app';
}
export interface CallUiStatus { supported: boolean; notifications: boolean; channel: boolean; fullScreen: boolean; specialAccessRequired?: boolean }
export function callSettingsTarget(status: CallUiStatus | undefined): 'full-screen' | 'notifications' | 'none' {
  if (!status?.supported) return 'none';
  if (status.notifications && status.channel && status.fullScreen) return 'none';
  if (status.notifications && status.channel && !status.fullScreen) return 'full-screen';
  return 'notifications';
}
export function callStatusText(enabled: boolean, status?: CallUiStatus): string {
  if (!status?.supported) return 'Системный экран звонка доступен на Android 8+. В этой версии звонок открывается внутри приложения.';
  if (!enabled) return 'Не удалось включить системные входящие звонки. Экран звонка внутри приложения остаётся доступен.';
  if (!status.notifications) return 'Разрешите уведомления LastCall, иначе входящий звонок не появится на заблокированном экране.';
  if (!status.channel) return 'Включите канал «Входящие звонки LastCall» в настройках уведомлений.';
  if (!status.fullScreen) return 'Разрешите полноэкранные уведомления LastCall (Android 14+). Без них звонок показывается как уведомление.';
  return 'Системные входящие звонки включены. Телефонный аккаунт LastCall регистрируется автоматически.';
}
interface NativeCallPort {
  present(uuid: string, name: string, video: boolean, expiresAt: number): Promise<boolean>;
  showUi(uuid: string, name: string, video: boolean, expiresAt: number): boolean;
  dismiss(uuid: string): void;
  activate(uuid: string): void;
  end(uuid: string): void;
  startAudio(uuid: string, video: boolean): Promise<void>;
  stopAudio(uuid: string): void;
  retain(manager: Manager, uuid: string): () => void;
}
interface LiveCall { id: string; uuid: string; manager: Manager; name: string; video: boolean; expiresAt: number; release: () => void; timer?: ReturnType<typeof setTimeout>; answering: boolean; presented: boolean; audioStarted: boolean; uiShown: boolean; activated: boolean }
/** Core must authenticate a pending invitation or P2P call before it enters this controller. */
export class SystemCallController {
  private current?: LiveCall;
  private pendingUi?: string;
  private pendingAnswer?: string;
  private pendingEnd?: string;
  constructor(private port: NativeCallPort) {}
  update(snapshot: MessengerSnapshot, manager: Manager): void {
    const call = snapshot.activeCall;
    if (this.current && (this.current.manager !== manager || call?.session.callId !== this.current.id || call.session.callState === 'idle')) this.clear();
    if (!call?.session.callId) return;
    if (!this.current && call.session.callState === 'incoming') {
      const id = call.session.callId;
      const expiresAt = Math.min(call.session.callExpiresAt ?? Date.now() + 30_000, Date.now() + 30_000);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) { manager.endCall(); return; }
      const name = snapshot.contacts.find(user => user.userId === call.peerId)?.displayName ?? 'LastCall';
      const live: LiveCall = { id, uuid: nativeCallUuid(id), manager, name, video: !!call.session.callVideo, expiresAt, release: this.port.retain(manager, nativeCallUuid(id)), answering: false, presented: false, audioStarted: false, uiShown: false, activated: false };
      this.current = live;
      live.timer = setTimeout(() => { if (this.current === live && manager.getSnapshot().activeCall?.session.callState !== 'active') { manager.endCall(); this.clear(); } }, Math.max(0, expiresAt - Date.now()));
      // Own CallStyle UI is independent of ICE or Telecom's async showIncomingCallUi callback.
      this.showUi(live.uuid);
      void this.port.present(live.uuid, name, live.video, expiresAt).then(success => {
        if (this.current !== live) { if (success) this.port.end(live.uuid); return; }
        if (!success) { this.clear(); return; }
        live.presented = true;
        // Cold native showIncomingCallUi can arrive before the encrypted snapshot is restored.
        if (this.pendingUi === live.uuid) { this.pendingUi = undefined; this.showUi(live.uuid); }
      }).catch(() => this.fail(live));
    }
    const live = this.current;
    if (!live) return;
    if (this.pendingUi === live.uuid && live.presented) { this.pendingUi = undefined; this.showUi(live.uuid); }
    if (this.pendingAnswer === live.uuid) { this.pendingAnswer = undefined; void this.answer(live.uuid); return; }
    if (this.pendingEnd === live.uuid) { this.pendingEnd = undefined; this.end(live.uuid); return; }
    if (call.session.callState === 'active') this.activate(live);
  }
  private matches(uuid: string): LiveCall | undefined {
    const live = this.current;
    return live?.uuid === uuid && live.manager.getSnapshot().activeCall?.session.callId === live.id ? live : undefined;
  }
  /** CallKeep callbacks and the authenticated invitation observer share one UI owner/UUID. */
  showUi(uuid: string): boolean {
    const live = this.matches(uuid);
    if (!live) { if (nativeUuid.test(uuid)) this.pendingUi = uuid; return false; }
    if (live.uiShown || live.manager.getSnapshot().activeCall?.session.callState !== 'incoming') return true;
    live.uiShown = this.port.showUi(live.uuid, live.name, live.video, live.expiresAt); return true;
  }
  /** A foreground call was answered in CallOverlay; show native UI only if the app leaves foreground. */
  remindUi(): void {
    const live = this.current;
    if (live && live.presented && !live.uiShown && live.manager.getSnapshot().activeCall?.session.callState === 'incoming') this.showUi(live.uuid);
  }
  async answer(uuid?: string): Promise<boolean> {
    const live = uuid ? this.matches(uuid) : this.current;
    if (!live) { if (uuid && nativeUuid.test(uuid)) this.pendingAnswer = uuid; return false; }
    if (live.manager.getSnapshot().activeCall?.session.callState !== 'incoming') return false;
    if (Date.now() >= live.expiresAt) { this.end(live.uuid); return false; }
    if (live.answering) return true;
    live.answering = true;
    try {
      await this.port.startAudio(live.uuid, !!live.manager.getSnapshot().activeCall?.session.callVideo);
      if (this.current !== live || Date.now() >= live.expiresAt || live.manager.getSnapshot().activeCall?.session.callId !== live.id || live.manager.getSnapshot().activeCall?.session.callState !== 'incoming') { this.port.stopAudio(live.uuid); return true; }
      live.audioStarted = true;
      await live.manager.acceptCall();
      if (this.current === live && live.manager.getSnapshot().activeCall?.session.callId === live.id && live.manager.getSnapshot().activeCall?.session.callState === 'active') this.activate(live);
    } catch { this.fail(live); }
    return true;
  }
  end(uuid: string): void {
    const live = this.matches(uuid);
    if (live) { live.manager.endCall(); this.clear(); }
    else if (nativeUuid.test(uuid)) this.pendingEnd = uuid;
  }
  mute(uuid: string, muted: boolean): void { this.matches(uuid)?.manager.setMuted(muted); }
  failCurrent(uuid: string): void { const live = this.matches(uuid); if (live) this.fail(live); }
  private fail(live: LiveCall): void { if (this.current !== live) return; live.manager.endCall(); this.clear(); }
  private activate(live: LiveCall): void { clearTimeout(live.timer); if (!live.activated) { live.activated = true; this.port.activate(live.uuid); } this.dismissUi(live); }
  private dismissUi(live: LiveCall): void { if (!live.uiShown) return; live.uiShown = false; this.port.dismiss(live.uuid); }
  private clear(): void {
    const live = this.current; if (!live) return; this.current = undefined;
    clearTimeout(live.timer); this.port.dismiss(live.uuid); this.port.end(live.uuid); this.port.stopAudio(live.uuid); live.release();
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
