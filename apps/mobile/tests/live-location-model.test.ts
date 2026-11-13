import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceMeters, liveLocationExpired, shouldUpdateLiveLocation, untilFromDuration } from '../src/live-location-model';

test('distance between two close points is a small, plausible number of meters', () => {
  // Red Square to the Kremlin: a few hundred meters, not kilometers and not zero.
  const meters = distanceMeters(55.7539, 37.6208, 55.7520, 37.6175);
  assert.ok(meters > 100 && meters < 600, String(meters));
  assert.equal(distanceMeters(10, 20, 10, 20), 0);
});

test('an update never fires before the 20s floor, and needs 15m+ movement once past it', () => {
  const last = { lastSentAt: 1000, lastLat: 55.0, lastLng: 37.0 };
  assert.equal(shouldUpdateLiveLocation(last, 55.01, 37.01, 1000 + 19999), false); // too soon even with real movement
  assert.equal(shouldUpdateLiveLocation(last, 55.0, 37.0, 1000 + 20000), false); // past the floor, but stationary
  assert.equal(shouldUpdateLiveLocation(last, 55.0003, 37.0, 1000 + 20000), true); // past the floor and moved ~33m
});

test('an update is forced at least once a minute even while stationary', () => {
  const last = { lastSentAt: 1000, lastLat: 55.0, lastLng: 37.0 };
  assert.equal(shouldUpdateLiveLocation(last, 55.0, 37.0, 1000 + 59999), false);
  assert.equal(shouldUpdateLiveLocation(last, 55.0, 37.0, 1000 + 60000), true);
});

test('a move under 15m does not trigger an early update, a move at or above it does', () => {
  const last = { lastSentAt: 1000, lastLat: 0, lastLng: 0 };
  const now = 1000 + 25000; // past the 20s floor, short of the 60s forced refresh
  const near = 0.00005; // roughly 5.5m of longitude at the equator
  const far = 0.0002; // roughly 22m
  assert.equal(shouldUpdateLiveLocation(last, 0, near, now), false);
  assert.equal(shouldUpdateLiveLocation(last, 0, far, now), true);
});

test('expiry and duration arithmetic', () => {
  assert.equal(liveLocationExpired(1000, 999), false);
  assert.equal(liveLocationExpired(1000, 1000), true);
  assert.equal(liveLocationExpired(1000, 1001), true);
  assert.equal(untilFromDuration(15, 0), 15 * 60000);
  assert.equal(untilFromDuration(480, 1000), 1000 + 480 * 60000);
});
