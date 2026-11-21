import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceFrom, LIVE_STALE_MS, mapPins, type MapMessage } from '../src/location-map-model';
import { formatLocationText } from '../src/location-contact';

const me = 'a'.repeat(64), alex = 'b'.repeat(64), maria = 'c'.repeat(64);
const now = 1_800_000_000_000;
const here = { lat: 55.7539, lng: 37.6208, at: now };
const live = (id: string, from: string, lat: number, lng: number, at: number): MapMessage => ({ id, from, text: formatLocationText('Live location · until 18:45', lat, lng, true), timestamp: at - 60000, editedAt: at });
const place = (id: string, from: string, lat: number, lng: number, at: number): MapMessage => ({ id, from, text: formatLocationText('Kremlin', lat, lng, false), timestamp: at });
const summary = (pins: ReturnType<typeof mapPins>) => pins.map(pin => [pin.kind, pin.ownerId === me ? 'me' : pin.ownerId === alex ? 'alex' : 'maria', pin.self]);

test('a live share shows the sharer and where the viewer is now', () => {
  assert.deepEqual(summary(mapPins([live('m1', alex, 55.75, 37.62, now - 30000)], 'm1', me, here, now)), [['live', 'alex', false], ['device', 'me', true]]);
});

test('everyone sharing is on the map, newest share per person; the viewer\'s own share replaces the phone position', () => {
  const messages = [live('old', alex, 1, 1, now - 600000), live('new', alex, 2, 2, now - 10000), live('mine', me, 3, 3, now - 5000), live('m', maria, 4, 4, now - 20000)];
  const pins = mapPins(messages, 'new', me, here, now);
  assert.deepEqual(summary(pins), [['live', 'alex', false], ['live', 'me', true], ['live', 'maria', false]]);
  assert.equal(pins[0]!.messageId, 'new');
  assert.equal(pins[1]!.lat, 3);
});

test('a place I sent is its own named pin, and "You" stays where I am now', () => {
  const pins = mapPins([place('p', me, 55.757, 37.61, now - 1000)], 'p', me, here, now);
  assert.deepEqual(summary(pins), [['place', 'me', false], ['device', 'me', true]]);
  assert.equal(pins[0]!.label, 'Kremlin');
  const meters = distanceFrom(pins[1], pins[0]!)!;
  assert.ok(meters > 100 && meters < 2000, String(meters));
  assert.equal(distanceFrom(pins[1], pins[1]!), undefined);
});

test('a share left by a killed app stops counting after 8 hours but its card still opens at the last point', () => {
  const pins = mapPins([live('dead', maria, 1, 1, now - LIVE_STALE_MS - 1)], 'dead', me, undefined, now);
  assert.deepEqual(summary(pins), [['place', 'maria', false]]);
  assert.equal(pins[0]!.label, '');
});

test('without the viewer\'s position there is no "You" pin and no distance', () => {
  const pins = mapPins([live('m1', alex, 55.75, 37.62, now)], 'm1', me, undefined, now);
  assert.equal(pins.length, 1);
  assert.equal(distanceFrom(undefined, pins[0]!), undefined);
});
