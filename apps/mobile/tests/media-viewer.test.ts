import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOUBLE_TAP_ZOOM, MAX_ZOOM, viewerExtension, viewerKind, ZoomGesture } from '../src/media-viewer-model';

test('photos and videos open in the viewer, recordings and other files do not', () => {
  assert.equal(viewerKind({ name: 'IMG_1.jpg', mime: 'image/jpeg' }), 'image');
  assert.equal(viewerKind({ name: 'shot.png', mime: 'image/png' }), 'image');
  assert.equal(viewerKind({ name: 'clip.mp4', mime: 'video/mp4' }), 'video');
  assert.equal(viewerKind({ name: 'clip.mov', mime: 'video/quicktime' }), 'video');
  assert.equal(viewerKind({ name: `lastcall-circle-${'ab'.repeat(16)}.mp4`, mime: 'video/mp4' }), undefined);
  assert.equal(viewerKind({ name: `lastcall-voice-${'ab'.repeat(16)}.m4a`, mime: 'audio/mp4' }), undefined);
  assert.equal(viewerKind({ name: 'icon.svg', mime: 'image/svg+xml' }), undefined);
  assert.equal(viewerKind({ name: 'doc.pdf', mime: 'application/pdf' }), undefined);
  assert.equal(viewerExtension('video/quicktime'), 'mov');
  assert.equal(viewerExtension('image/jpeg'), 'jpg');
});

const box = { width: 400, height: 800 };
test('pinch zooms around the fingers and stays within limits', () => {
  const zoom = new ZoomGesture(box);
  zoom.begin([{ x: 150, y: 400 }, { x: 250, y: 400 }], 0);
  const view = zoom.move([{ x: 100, y: 400 }, { x: 300, y: 400 }], 50);
  assert.equal(view.scale, 2);
  // The point between the fingers (the center) stays where it was.
  assert.equal(view.x, 0);
  zoom.move([{ x: 0, y: 400 }, { x: 2000, y: 400 }], 80);
  assert.equal(zoom.view.scale, MAX_ZOOM);
  const done = zoom.end({ x: 200, y: 400 }, 120);
  assert.equal(done.tap, false);
  assert.equal(done.view.scale, MAX_ZOOM);
});

test('a zoomed photo can be dragged, but not past its edges; zooming out recenters', () => {
  const zoom = new ZoomGesture(box);
  zoom.begin([{ x: 150, y: 400 }, { x: 250, y: 400 }], 0);
  zoom.move([{ x: 100, y: 400 }, { x: 300, y: 400 }], 50);
  zoom.end({ x: 200, y: 400 }, 400);
  zoom.begin([{ x: 200, y: 400 }], 1000);
  const dragged = zoom.move([{ x: 900, y: 400 }], 1100);
  assert.equal(dragged.x, box.width / 2); // scale 2: at most half the width either way
  zoom.end({ x: 900, y: 400 }, 1200);
  zoom.begin([{ x: 100, y: 400 }, { x: 300, y: 400 }], 2000);
  zoom.move([{ x: 190, y: 400 }, { x: 210, y: 400 }], 2050);
  assert.deepEqual(zoom.end({ x: 200, y: 400 }, 2100).view, { scale: 1, x: 0, y: 0 });
});

test('one tap is a tap, two quick taps zoom in and then back out', () => {
  const zoom = new ZoomGesture(box);
  zoom.begin([{ x: 100, y: 200 }], 0);
  const first = zoom.end({ x: 100, y: 200 }, 80);
  assert.equal(first.tap, true); assert.equal(first.doubleTap, false);
  zoom.begin([{ x: 100, y: 200 }], 200);
  const second = zoom.end({ x: 100, y: 200 }, 260);
  assert.equal(second.doubleTap, true);
  assert.equal(second.view.scale, DOUBLE_TAP_ZOOM);
  assert.ok(second.view.x > 0 && second.view.y > 0); // the tapped upper-left area moves toward the center
  zoom.begin([{ x: 100, y: 200 }], 400);
  zoom.end({ x: 100, y: 200 }, 450);
  zoom.begin([{ x: 100, y: 200 }], 600);
  assert.deepEqual(zoom.end({ x: 100, y: 200 }, 650).view, { scale: 1, x: 0, y: 0 });
});
