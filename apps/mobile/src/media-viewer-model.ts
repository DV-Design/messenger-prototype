import { mediaKind } from './media-model';

/** Received and sent photos and videos open in the app's own full-screen viewer; other files go to the share menu. */
export type ViewerKind = 'image' | 'video';
const IMAGE = /^image\/(?:jpeg|jpg|png|gif|webp|heic|heif|bmp)$/i;
const VIDEO = /^video\/(?:mp4|quicktime|webm|3gpp|3gpp2|x-matroska|x-m4v)$/i;

export function viewerKind(file: { name: string; mime: string }): ViewerKind | undefined {
  // Voice messages and video circles play inside their bubble.
  if (mediaKind(file.name, file.mime)) return undefined;
  if (IMAGE.test(file.mime)) return 'image';
  if (VIDEO.test(file.mime)) return 'video';
}

/** File extension for a temporary copy the video player can read. */
export function viewerExtension(mime: string): string {
  const type = mime.toLowerCase();
  if (type === 'video/quicktime') return 'mov';
  if (type === 'video/webm') return 'webm';
  if (type.startsWith('video/3gpp')) return '3gp';
  if (type === 'video/x-matroska') return 'mkv';
  if (type.startsWith('video/')) return 'mp4';
  if (type === 'image/png') return 'png';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  if (type === 'image/bmp') return 'bmp';
  return 'jpg';
}

export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;
export interface Point { x: number; y: number }
export interface ZoomView { scale: number; x: number; y: number }

/**
 * Pinch to zoom, drag a zoomed photo, double tap to zoom in and out, like a gallery.
 * Pure arithmetic over touch points, so it runs and is tested without a phone.
 */
export class ZoomGesture {
  view: ZoomView = { scale: 1, x: 0, y: 0 };
  private base: ZoomView = this.view;
  private startDistance = 0;
  private startCenter: Point = { x: 0, y: 0 };
  private fingers = 0;
  private moved = false;
  private startedAt = 0;
  private lastTap = -Infinity;

  constructor(private box: { width: number; height: number }) {}

  resize(box: { width: number; height: number }) { this.box = box; this.view = this.clamp(this.view); }

  /** A finger went down or the number of fingers changed. */
  begin(touches: readonly Point[], now: number) {
    if (!this.fingers) { this.moved = false; this.startedAt = now; }
    this.fingers = touches.length;
    this.base = this.view;
    this.startCenter = center(touches);
    this.startDistance = touches.length >= 2 ? distance(touches[0]!, touches[1]!) : 0;
  }

  move(touches: readonly Point[], now: number): ZoomView {
    if (touches.length !== this.fingers) this.begin(touches, now);
    const point = center(touches);
    if (Math.hypot(point.x - this.startCenter.x, point.y - this.startCenter.y) > TAP_SLOP) this.moved = true;
    if (touches.length >= 2 && this.startDistance > 0) {
      this.moved = true;
      const scale = Math.min(MAX_ZOOM, Math.max(1, this.base.scale * distance(touches[0]!, touches[1]!) / this.startDistance));
      // Keep the point between the fingers under the fingers while zooming.
      const ratio = scale / this.base.scale;
      const origin = { x: this.startCenter.x - this.box.width / 2, y: this.startCenter.y - this.box.height / 2 };
      this.view = this.clamp({
        scale,
        x: origin.x - (origin.x - this.base.x) * ratio + (point.x - this.startCenter.x),
        y: origin.y - (origin.y - this.base.y) * ratio + (point.y - this.startCenter.y),
      });
    } else if (touches.length === 1 && this.base.scale > 1) {
      this.view = this.clamp({ scale: this.base.scale, x: this.base.x + point.x - this.startCenter.x, y: this.base.y + point.y - this.startCenter.y });
    }
    return this.view;
  }

  /** All fingers are up. A short touch without movement is a tap; two quick taps zoom. */
  end(point: Point, now: number): { view: ZoomView; tap: boolean; doubleTap: boolean } {
    this.fingers = 0;
    const tap = !this.moved && now - this.startedAt < 250;
    let doubleTap = false;
    if (tap && now - this.lastTap < DOUBLE_TAP_MS) {
      doubleTap = true; this.lastTap = -Infinity;
      if (this.view.scale > 1) this.view = { scale: 1, x: 0, y: 0 };
      else {
        const scale = DOUBLE_TAP_ZOOM;
        this.view = this.clamp({ scale, x: (this.box.width / 2 - point.x) * (scale - 1), y: (this.box.height / 2 - point.y) * (scale - 1) });
      }
    } else if (tap) this.lastTap = now;
    if (this.view.scale <= 1.01) this.view = { scale: 1, x: 0, y: 0 };
    return { view: this.view, tap, doubleTap };
  }

  reset() { this.view = { scale: 1, x: 0, y: 0 }; this.lastTap = -Infinity; }

  private clamp(view: ZoomView): ZoomView {
    const limitX = this.box.width * (view.scale - 1) / 2;
    const limitY = this.box.height * (view.scale - 1) / 2;
    return { scale: view.scale, x: Math.min(limitX, Math.max(-limitX, view.x)), y: Math.min(limitY, Math.max(-limitY, view.y)) };
  }
}

function center(touches: readonly Point[]): Point {
  if (!touches.length) return { x: 0, y: 0 };
  const sum = touches.reduce((total, touch) => ({ x: total.x + touch.x, y: total.y + touch.y }), { x: 0, y: 0 });
  return { x: sum.x / touches.length, y: sum.y / touches.length };
}
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
