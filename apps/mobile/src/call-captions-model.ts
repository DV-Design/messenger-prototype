import { CALL_CAPTION_TEXT_MAX, type CallCaption, type CallCaptionFrame, type CallCaptionState } from '@messenger/core';

export const CAPTION_LANGUAGES = [
  { code: 'ru', tag: 'ru-RU', label: 'Русский' }, { code: 'en', tag: 'en-US', label: 'English' }, { code: 'de', tag: 'de-DE', label: 'Deutsch' },
  { code: 'fr', tag: 'fr-FR', label: 'Français' }, { code: 'es', tag: 'es-ES', label: 'Español' }, { code: 'it', tag: 'it-IT', label: 'Italiano' },
  { code: 'pt', tag: 'pt-BR', label: 'Português' }, { code: 'tr', tag: 'tr-TR', label: 'Türkçe' }, { code: 'uk', tag: 'uk-UA', label: 'Українська' },
  { code: 'pl', tag: 'pl-PL', label: 'Polski' }, { code: 'nl', tag: 'nl-NL', label: 'Nederlands' }, { code: 'zh', tag: 'zh-CN', label: '中文' },
  { code: 'ja', tag: 'ja-JP', label: '日本語' }, { code: 'ko', tag: 'ko-KR', label: '한국어' }, { code: 'ar', tag: 'ar-SA', label: 'العربية' },
  { code: 'hi', tag: 'hi-IN', label: 'हिन्दी' },
] as const;
export type CaptionLanguage = typeof CAPTION_LANGUAGES[number]['code'];
export function captionLanguage(code: string | null | undefined): CaptionLanguage {
  return CAPTION_LANGUAGES.find(item => item.code === code)?.code ?? 'en';
}
const speechTag = (code: string) => CAPTION_LANGUAGES.find(item => item.code === code)?.tag ?? code;

/** The status text belongs to the language it was read for. Both are empty until they load. */
export function captionSpeechNote(speech: { language: CaptionLanguage; text: string } | undefined, language: CaptionLanguage | undefined): string {
  return speech && speech.language === language ? speech.text : '';
}

/** ready: installed. download: on this phone after a download. offline-unavailable: only cloud or nothing. */
export type SpeechStatus = 'ready' | 'download' | 'downloading' | 'unavailable';
export interface CaptionNative {
  speechStatus(language: string, tag: string): Promise<{ status: SpeechStatus; tag?: string }>;
  downloadSpeech(tag: string): Promise<void>;
  startSpeech(tag: string): Promise<void>;
  stopSpeech(): void;
  setSpeechMuted(muted: boolean): void;
  prepareTranslation(source: string, target: string): Promise<void>;
  translate(source: string, target: string, text: string): Promise<string>;
  releaseTranslation(): void;
}
export type SpeechEvent = { type: 'partial' | 'final'; text: string } | { type: 'error'; code: string };
export interface CaptionScheduler { set(callback: () => void, delayMs: number): unknown; clear(handle: unknown): void; now(): number }
export interface CaptionLine { segment: number; original: string; text: string; final: boolean; translated: boolean }
export interface CaptionsView {
  enabled: boolean;
  peerEnabled: boolean;
  /** The peer wants captions and this person has not answered. */
  asked: boolean;
  speech: SpeechStatus | 'off';
  peerSpeech?: CallCaptionState['speech'];
  translation: 'none' | 'preparing' | 'ready' | 'failed';
  lines: CaptionLine[];
  own: string;
}
export const CAPTION_PARTIAL_MS = 300;
export const CAPTION_TRANSLATE_MS = 700;
const MAX_LINES = 3;
const DOWNLOAD_POLL_MS = 3000;
const DOWNLOAD_POLLS = 60;
const emptyView = (): CaptionsView => ({ enabled: false, peerEnabled: false, asked: false, speech: 'off', translation: 'none', lines: [], own: '' });

/** Splits a long final utterance at spaces; a frame stays within the protocol limit and no words are cut off. */
export function splitCaption(text: string, limit = CALL_CAPTION_TEXT_MAX): string[] {
  const parts: string[] = []; let rest = text.trim();
  while (rest.length > limit) {
    const space = rest.lastIndexOf(' ', limit);
    const end = space > 0 ? space : limit;
    parts.push(rest.slice(0, end).trim()); rest = rest.slice(end).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Both people enabling captions is the consent for each phone to recognize its owner's speech.
 * Words live only here, in memory, and are dropped when the call ends.
 */
export class CallCaptionsController {
  private view = emptyView();
  private callId?: string;
  private available = false;
  private muted = false;
  private disposed = false;
  private declined = false;
  private peerLanguage?: string;
  private speechTag?: string;
  private listening = false;
  private checking = 0;
  private pollTimer: unknown;
  private segment = 0;
  private revision = 0;
  private pendingText = '';
  private lastPartialAt = 0;
  private partialTimer: unknown;
  private translateTimer: unknown;
  private preparedPair?: string;
  private preparing?: string;
  private translationToken = 0;
  private seen = new Map<number, number>();

  constructor(private readonly deps: {
    native: CaptionNative;
    language: string;
    send(frame: CallCaptionFrame): Promise<boolean>;
    onChange(view: CaptionsView): void;
    scheduler?: CaptionScheduler;
  }) {}

  private get scheduler(): CaptionScheduler {
    return this.deps.scheduler ?? { set: (callback, delay) => setTimeout(callback, delay), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => Date.now() };
  }
  get language() { return this.deps.language; }
  snapshot() { return this.view; }

  private update(change: Partial<CaptionsView>) {
    this.view = { ...this.view, ...change };
    this.view.asked = this.view.peerEnabled && !this.view.enabled && !this.declined;
    if (!this.disposed) this.deps.onChange(this.view);
  }
  private transmit(frame: CallCaptionFrame) { void this.deps.send(frame).catch(() => {}); }
  private sendState() {
    if (!this.callId) return;
    const speech = this.view.speech === 'ready' ? 'ready' : this.view.speech === 'unavailable' ? 'unavailable' : 'preparing';
    this.transmit({ kind: 'call-caption-state', callId: this.callId, enabled: this.view.enabled, language: this.deps.language, speech });
  }

  /** `available` goes false during a transport recovery; returning re-announces the state the peer may have missed. */
  setCall(callId: string | undefined, available: boolean) {
    if (callId !== this.callId && this.callId) this.reset();
    const returned = available && !this.available;
    this.callId = callId; this.available = available;
    if (returned && this.view.enabled) this.sendState();
  }
  setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    // Muted speech is not recognized, even though WebRTC keeps its microphone open.
    this.deps.native.setSpeechMuted(muted);
    if (muted) this.flushPartial(true);
  }
  toggle() { this.setEnabled(!this.view.enabled); }
  decline() { this.declined = true; this.update({}); }
  setEnabled(enabled: boolean) {
    if (enabled === this.view.enabled || !this.callId) return;
    if (!enabled) {
      this.stopListening();
      this.clearLines();
      this.update({ enabled: false, speech: 'off', translation: 'none', own: '' });
      this.sendState();
      this.deps.native.releaseTranslation(); this.preparedPair = undefined;
      return;
    }
    this.declined = false;
    this.update({ enabled: true, speech: 'downloading' });
    this.sendState();
    this.prepareTranslation();
    void this.checkSpeech(0);
  }

  private async checkSpeech(polls: number) {
    const token = ++this.checking;
    let result: { status: SpeechStatus; tag?: string };
    try { result = await this.deps.native.speechStatus(this.deps.language, speechTag(this.deps.language)); }
    catch { result = { status: 'unavailable' }; }
    if (token !== this.checking || !this.view.enabled || this.disposed) return;
    this.speechTag = result.tag ?? speechTag(this.deps.language);
    if (result.status === 'download' && polls === 0) {
      try { await this.deps.native.downloadSpeech(this.speechTag); }
      catch { this.update({ speech: 'unavailable' }); this.sendState(); return; }
      if (token !== this.checking || !this.view.enabled) return;
      result = { status: 'downloading' };
    }
    if (result.status === 'download' || result.status === 'downloading') {
      if (polls >= DOWNLOAD_POLLS) { this.update({ speech: 'unavailable' }); this.sendState(); return; }
      if (this.view.speech !== 'downloading') { this.update({ speech: 'downloading' }); this.sendState(); }
      this.pollTimer = this.scheduler.set(() => void this.checkSpeech(polls + 1), DOWNLOAD_POLL_MS);
      return;
    }
    this.update({ speech: result.status });
    this.sendState();
    this.syncListening();
  }
  private syncListening() {
    const want = this.view.enabled && this.view.peerEnabled && this.view.speech === 'ready' && !!this.callId && !this.disposed;
    if (want && !this.listening && this.speechTag) {
      this.listening = true;
      this.deps.native.setSpeechMuted(this.muted);
      this.deps.native.startSpeech(this.speechTag).catch(() => this.onSpeech({ type: 'error', code: 'start' }));
    } else if (!want && this.listening) this.stopListening();
  }
  private stopListening() {
    this.checking++;
    this.scheduler.clear(this.pollTimer); this.pollTimer = undefined;
    this.scheduler.clear(this.partialTimer); this.partialTimer = undefined; this.pendingText = '';
    if (this.listening) { this.listening = false; this.deps.native.stopSpeech(); }
  }

  /** Native recognizer events for this person's own speech. */
  onSpeech(event: SpeechEvent) {
    if (this.disposed || !this.listening) return;
    if (event.type === 'error') {
      this.listening = false; this.deps.native.stopSpeech();
      this.update({ speech: 'unavailable', own: '' }); this.sendState();
      return;
    }
    if (this.muted) return;
    const text = event.text.trim();
    if (event.type === 'final') {
      this.scheduler.clear(this.partialTimer); this.partialTimer = undefined; this.pendingText = '';
      for (const part of splitCaption(text)) { this.transmitCaption(part, true); }
      if (!text && this.revision > 0) this.transmitCaption('', true);
      if (text) this.update({ own: text.slice(-CALL_CAPTION_TEXT_MAX) });
      return;
    }
    if (!text) return;
    this.pendingText = text.slice(-CALL_CAPTION_TEXT_MAX);
    this.update({ own: this.pendingText });
    const wait = CAPTION_PARTIAL_MS - (this.scheduler.now() - this.lastPartialAt);
    if (wait <= 0) this.flushPartial(false);
    else if (this.partialTimer === undefined) this.partialTimer = this.scheduler.set(() => { this.partialTimer = undefined; this.flushPartial(false); }, wait);
  }
  private flushPartial(asFinal: boolean) {
    if (asFinal) { this.scheduler.clear(this.partialTimer); this.partialTimer = undefined; }
    const text = this.pendingText; this.pendingText = '';
    if (text) this.transmitCaption(text, asFinal);
  }
  private transmitCaption(text: string, final: boolean) {
    if (!this.callId) return;
    this.lastPartialAt = this.scheduler.now();
    this.transmit({ kind: 'call-caption', callId: this.callId, language: this.deps.language, segment: this.segment, revision: this.revision, final, text });
    if (final) { this.segment++; this.revision = 0; } else this.revision++;
  }

  /** Frames from the peer, already authenticated and matched to this call by core. */
  onFrame(frame: CallCaptionFrame) {
    if (this.disposed || frame.callId !== this.callId) return;
    if (frame.kind === 'call-caption-state') this.onPeerState(frame);
    else this.onPeerCaption(frame);
  }
  private onPeerState(frame: CallCaptionState) {
    const arrived = frame.enabled && !this.view.peerEnabled;
    const languageChanged = this.peerLanguage !== frame.language;
    this.peerLanguage = frame.language;
    if (!frame.enabled) this.clearLines();
    if (arrived) this.declined = false;
    this.update({ peerEnabled: frame.enabled, peerSpeech: frame.speech });
    if (arrived && this.view.enabled) this.sendState();
    if (languageChanged) { this.prepareTranslation(); }
    this.syncListening();
  }
  private onPeerCaption(frame: CallCaption) {
    if (!this.view.enabled || !this.view.peerEnabled) return;
    const seenRevision = this.seen.get(frame.segment);
    if (seenRevision === Infinity || (seenRevision !== undefined && seenRevision >= frame.revision && !frame.final)) return;
    this.seen.set(frame.segment, frame.final ? Infinity : frame.revision);
    if (this.seen.size > 32) this.seen.delete(this.seen.keys().next().value as number);
    if (frame.language !== this.peerLanguage) { this.peerLanguage = frame.language; this.prepareTranslation(); }
    const same = frame.language === this.deps.language;
    const lines = this.view.lines.slice();
    const index = lines.findIndex(line => line.segment === frame.segment);
    if (!frame.text) {
      if (index >= 0) { lines.splice(index, 1); this.update({ lines }); }
      return;
    }
    if (index < 0 && lines.some(line => line.segment > frame.segment)) return;
    const previous = index >= 0 ? lines[index] : undefined;
    const line: CaptionLine = { segment: frame.segment, original: frame.text, text: same || !previous?.translated ? frame.text : previous.text, final: frame.final, translated: same || !!previous?.translated };
    if (index >= 0) lines[index] = line; else lines.push(line);
    this.update({ lines: lines.slice(-MAX_LINES) });
    if (same) return;
    if (frame.final) { this.scheduler.clear(this.translateTimer); this.translateTimer = undefined; void this.translateLine(frame.segment); }
    else if (this.translateTimer === undefined) this.translateTimer = this.scheduler.set(() => { this.translateTimer = undefined; const latest = this.view.lines.find(item => !item.final); if (latest) void this.translateLine(latest.segment); }, CAPTION_TRANSLATE_MS);
  }
  private clearLines() {
    this.scheduler.clear(this.translateTimer); this.translateTimer = undefined; this.translationToken++; this.seen.clear();
    this.update({ lines: [] });
  }
  private prepareTranslation() {
    const source = this.peerLanguage, target = this.deps.language;
    if (!this.view.enabled || !source) return;
    if (source === target) { this.update({ translation: 'none' }); return; }
    const pair = `${source}:${target}`;
    if (this.preparedPair === pair || this.preparing === pair) return;
    this.preparing = pair; this.update({ translation: 'preparing' });
    this.deps.native.prepareTranslation(source, target).then(() => {
      if (this.preparing !== pair || this.disposed) return;
      this.preparing = undefined; this.preparedPair = pair; this.update({ translation: 'ready' });
      for (const line of this.view.lines) if (!line.translated) void this.translateLine(line.segment);
    }, () => {
      if (this.preparing !== pair || this.disposed) return;
      this.preparing = undefined; this.update({ translation: 'failed' });
    });
  }
  private async translateLine(segment: number) {
    const source = this.peerLanguage, target = this.deps.language;
    if (!source || this.preparedPair !== `${source}:${target}`) return;
    const line = this.view.lines.find(item => item.segment === segment); if (!line) return;
    const token = ++this.translationToken; const original = line.original;
    let text: string;
    try { text = await this.deps.native.translate(source, target, original); }
    catch { return; }
    if (this.disposed) return;
    // A final's translation is never overwritten by an older partial that resolves after it.
    const current = this.view.lines.find(item => item.segment === segment);
    if (!current || (token !== this.translationToken && current.original !== original)) return;
    this.update({ lines: this.view.lines.map(item => item.segment === segment ? { ...item, text, translated: true } : item) });
  }
  private reset() {
    this.stopListening(); this.clearLines();
    this.deps.native.releaseTranslation();
    this.view = emptyView(); this.declined = false; this.peerLanguage = undefined; this.preparedPair = undefined; this.preparing = undefined; this.segment = 0; this.revision = 0;
  }
  dispose() {
    if (this.disposed) return;
    this.reset(); this.disposed = true;
  }
}
