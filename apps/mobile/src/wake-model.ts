export const WAKE_SYNC_BUDGET_MS = 9_000;
export type WakeNotice = { legacy: true } | { legacy: false; kind: 'message' | 'file' | 'call'; id: string; expiresAt: number };
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Accept Expo task, received-notification and response shapes, never payload URLs. */
export function parseWakeNotice(payload: unknown, now = Date.now()): WakeNotice | null {
  try {
    if (JSON.stringify(payload).length > 8192) return null;
    const root = object(payload); if (!root) return null;
    const notification = object(root.notification) ?? root;
    const content = object(object(notification.request)?.content);
    let data = object(content?.data) ?? object(root.data) ?? object(notification.data) ?? root;
    const encoded = data.dataString ?? data.body;
    if (typeof encoded === 'string') {
      if (encoded.length > 4096) return null;
      data = object(JSON.parse(encoded)) ?? {};
    }
    if (data.kind !== 'lastcall-wake') return null;
    if (data.intentKind === undefined && data.intentId === undefined && data.expiresAt === undefined) return { legacy: true };
    if (!['message', 'file', 'call'].includes(String(data.intentKind)) || typeof data.intentId !== 'string' || !/^[a-f0-9]{32}$/.test(data.intentId)
      || typeof data.expiresAt !== 'string' || !/^[0-9]{10,16}$/.test(data.expiresAt)) return null;
    const expiresAt = Number(data.expiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 65_000) return null;
    return { legacy: false, kind: data.intentKind as 'message' | 'file' | 'call', id: data.intentId, expiresAt };
  } catch { return null; }
}

export interface WakeLease { connect(): Promise<void>; release(): Promise<void> }
interface ManagedWakeClient { connect(): Promise<void>; disconnectAndFlush(): Promise<void> }
/** Expo58 Android foreground/headless share the application's single ReactHost. */
export class SharedWakeRuntime<T extends ManagedWakeClient> {
  private current: T | null = null;
  private foreground = false;
  private leases = 0;
  private retained = new Map<T, number>();
  private queue: Promise<unknown> = Promise.resolve();
  peek(): T | null { return this.current; }
  claimForeground(): void { this.foreground = true; }
  private serial<R>(operation: () => Promise<R>): Promise<R> {
    const next = this.queue.catch(() => {}).then(operation); this.queue = next; return next;
  }
  ensure(create: () => Promise<T | null>): Promise<T | null> {
    return this.serial(async () => { if (!this.current) this.current = await create(); return this.current; });
  }
  replace(create: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const previous = this.current; this.current = null;
      if (previous) await previous.disconnectAndFlush();
      this.current = await create(); return this.current;
    });
  }
  retain(value: T): () => Promise<void> {
    this.retained.set(value, (this.retained.get(value) ?? 0) + 1); let released = false;
    return () => { if (released) return Promise.resolve(); released = true; const count = (this.retained.get(value) ?? 1) - 1;
      if (count) this.retained.set(value, count); else this.retained.delete(value);
      return this.serial(() => this.closeIfUnused(value)).catch(() => {});
    };
  }
  private async closeIfUnused(value: T) {
    if (this.current !== value || this.foreground || this.leases || this.retained.has(value)) return;
    this.current = null; await value.disconnectAndFlush();
  }
  async acquire(create: () => Promise<T | null>, signal: AbortSignal): Promise<WakeLease | null> {
    const value = await this.ensure(async () => {
      if (signal.aborted) return null;
      const created = await create();
      if (signal.aborted && created) { await created.disconnectAndFlush(); return null; }
      return created;
    });
    if (!value) return null;
    this.leases++; let released = false;
    return {
      connect: () => value.connect(),
      release: () => this.serial(async () => {
        if (released) return; released = true; this.leases--;
        await this.closeIfUnused(value);
      }),
    };
  }
}
/** One bounded wake window; duplicate callbacks never extend it or double-own storage. */
export class WakeSyncCoordinator {
  private running?: Promise<void>;
  private seen = new Map<string, number>();
  private enqueuePreview?: (prepare: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  constructor(private readonly acquire: (signal: AbortSignal) => Promise<WakeLease | null>, private readonly now = Date.now,
    private readonly scheduler = { set: (callback: () => void, delay: number): unknown => setTimeout(callback, delay), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) }) {}
  run(notice: WakeNotice | null, beforeConnect?: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (!notice || notice.legacy || notice.expiresAt <= this.now()) return Promise.resolve();
    for (const [id, expiry] of this.seen) if (expiry <= this.now()) this.seen.delete(id);
    if (this.seen.has(notice.id)) return this.running ?? Promise.resolve();
    if (this.running) {
      if (!this.enqueuePreview) return this.running.then(() => this.run(notice, beforeConnect));
      if (this.seen.size >= 256) return this.running;
      this.seen.set(notice.id, notice.expiresAt);
      if (beforeConnect) void this.enqueuePreview?.(beforeConnect);
      return this.running;
    }
    if (this.seen.size >= 256) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(notice.id, notice.expiresAt);
    const controller = new AbortController();
    let markReady!: () => void; const acquired = new Promise<void>(resolve => { markReady = resolve; });
    let previews = Promise.resolve();
    this.enqueuePreview = prepare => {
      const next = previews.then(async () => { await acquired; if (!controller.signal.aborted) await prepare(controller.signal); });
      previews = next.catch(() => {}); return previews;
    };
    const initialPreview = beforeConnect ? this.enqueuePreview(beforeConnect) : undefined;
    let finish!: () => void;
    const deadline = new Promise<null>(resolve => { finish = () => { controller.abort(); resolve(null); }; });
    const timer = this.scheduler.set(finish, Math.min(WAKE_SYNC_BUDGET_MS, notice.expiresAt - this.now()));
    const operation = (async () => {
      const acquisition = Promise.resolve().then(() => this.acquire(controller.signal));
      let lease: WakeLease | null = null;
      try {
        lease = await Promise.race([acquisition, deadline]);
        if (!lease) {
          // Slow secure-store reads must not create a late unowned transport.
          void acquisition.then(late => late?.release()).catch(() => {});
          return;
        }
        markReady();
        if (!controller.signal.aborted && initialPreview) await Promise.race([initialPreview, deadline]);
        if (!controller.signal.aborted) await Promise.race([lease.connect(), deadline]);
        if (!controller.signal.aborted) await deadline;
      } catch { /* Durable sender queue retries when network/OS permits. */ }
      finally { this.scheduler.clear(timer); finish(); markReady(); this.enqueuePreview = undefined; await Promise.race([previews, deadline]); if (lease) await lease.release(); }
    })();
    this.running = operation.finally(() => { this.running = undefined; });
    return this.running;
  }
}

/** Per-intent reference counting: callback duplication cannot finish another owner's task. */
export class WakeTaskRegistry {
  private held = new Map<string, { owners: number; promise: Promise<void>; resolve: () => void }>();
  acquire(id: string): () => boolean {
    let value = this.held.get(id);
    if (!value) {
      if (this.held.size >= 32) throw new Error('Background runtime capacity exceeded');
      let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; });
      value = { owners: 0, promise, resolve }; this.held.set(id, value);
    }
    value.owners++; let released = false;
    return () => { if (released) return false; released = true; if (--value.owners) return false; this.held.delete(id); value.resolve(); return true; };
  }
  run(id: string): Promise<void> { return this.held.get(id)?.promise ?? Promise.resolve(); }
}

/** Acquire native timer ownership before creating any JS deadline; invalid intents pin nothing. */
export async function runWakeTask(notice: WakeNotice | null, acquire: (id: string) => Promise<() => void>, work: (notice: Extract<WakeNotice, { legacy: false }>) => Promise<void>, now = Date.now): Promise<void> {
  if (!notice || notice.legacy || notice.expiresAt <= now()) return;
  let release: (() => void) | undefined;
  try { release = await acquire(notice.id); if (notice.expiresAt > now()) await work(notice); }
  finally { release?.(); }
}
