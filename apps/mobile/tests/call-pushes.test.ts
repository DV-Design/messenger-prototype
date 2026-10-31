import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceIdentity, directConversationId, encryptCallPush, type MessengerSnapshot, type PendingIncomingCall } from '@messenger/core';
import { applyCallPush, parseCallPush, isCallPushPayload, callInviteCapability, callInviteNativeReady } from '../src/call-push-model';
import { SystemCallController } from '../src/system-call-model';
import { WakeSyncCoordinator } from '../src/wake-model';
const alice = createDeviceIdentity(n => new Uint8Array(n).fill(31)), bob = createDeviceIdentity(n => new Uint8Array(n).fill(32));
const callId = 'aa'.repeat(16), epoch = 'bb'.repeat(16), conversationId = directConversationId(alice.userId, bob.userId);
function payload(now = Date.now()) {
  const invitation = { callId, issuedAt: now, expiresAt: now + 30000 };
  return { kind: 'lastcall-call', intentKind: 'call', intentId: callId, expiresAt: String(invitation.expiresAt),
    callInvite: encryptCallPush(alice, bob.publicKey, invitation, epoch, { conversationId, video: false }) };
}
const terminal = (now = Date.now()) => ({ kind: 'lastcall-call-state', callId, callerId: alice.userId, calleeId: bob.userId, serverEpoch: epoch, issuedAt: String(now), expiresAt: String(now + 30000) });
test('bounded call parser supports actual Expo raw/headless/receipt/response/serialized wrappers without URLs', () => {
  const now = Date.now(), data = payload(now);
  for (const wrapped of [data, { data }, { notification: { data, notification: null } }, { request: { content: { data } } }, { notification: { request: { content: { data } } } }, { data: { dataString: JSON.stringify(data) } }, { notification: { data: { body: JSON.stringify(data) } } }]) {
    assert.equal(parseCallPush(wrapped, now)?.type, 'invitation'); assert.equal(isCallPushPayload(wrapped), true);
  }
  assert.equal(parseCallPush(terminal(now), now)?.type, 'state');
  for (const malformed of [{ ...data, expiresAt: String(now) }, { ...data, intentId: 'cc'.repeat(16) }, { ...data, url: 'https://example.invalid' }, { ...data, callInvite: 'x'.repeat(4096) },
    { ...terminal(now), serverEpoch: '../secret' }, { ...terminal(now), expiresAt: String(now + 30001) }, { data, notification: { data: { ...data, intentId: 'cc'.repeat(16) } } }, { data, huge: 'x'.repeat(13000) }]) assert.equal(parseCallPush(malformed, now), null);
  const cycle: Record<string, unknown> = {}; cycle.data = cycle; assert.equal(parseCallPush(cycle), null);
});
test('new capability needs native preparation and registered background task; denied FSI retains CallStyle fallback', () => {
  for (const background of [false, true]) for (const native of [false, true]) assert.equal(callInviteCapability(background, native), background && native);
  const deniedFullscreen = { supported: true, notifications: true, channel: true, fullScreen: false };
  assert.equal(callInviteNativeReady(deniedFullscreen), true); assert.equal(callInviteNativeReady(undefined), false);
  assert.equal(callInviteNativeReady({ ...deniedFullscreen, channel: false }), false);
});
function fixture(now = Date.now()) {
  const events: string[] = [];
  const pending: PendingIncomingCall = { callerId: alice.userId, callId, conversationId, video: false, issuedAt: now, expiresAt: now + 30000, serverEpoch: epoch, state: 'ringing', revision: 1 };
  let snapshot: MessengerSnapshot = { status: 'offline', contacts: [], conversations: [], self: { ...bob, username: 'bob', displayName: 'Bob', online: false, lastSeen: 0 } };
  const manager = {
    getSnapshot: () => snapshot,
    connect: async () => { events.push('directory'); },
    openCallPush: async () => {
      events.push('authenticated');
      snapshot = { ...snapshot, pendingIncomingCall: pending, activeCall: { conversationId, peerId: alice.userId,
        session: { setup: 'invitation', status: 'connecting', callState: 'incoming', callId, callExpiresAt: pending.expiresAt, stats: {}, route: 'unknown', muted: false, messages: [], files: [] } } };
      controller.update(snapshot, manager); return pending;
    },
    refreshCallState: async () => { events.push('state-fetch'); return { ...pending, calleeId: bob.userId, state: 'ringing' as const }; },
    acceptCall: async () => { events.push('accept'); }, endCall: () => { snapshot = { ...snapshot, activeCall: undefined, pendingIncomingCall: undefined }; }, setMuted: () => {},
  };
  const controller = new SystemCallController({
    present: async () => { events.push('telecom'); return true; }, showUi: () => { events.push('native-ui'); return true; }, dismiss: () => events.push('dismiss'),
    activate: () => events.push('active'), end: () => {}, startAudio: async () => { events.push('microphone'); }, stopAudio: () => {}, retain: () => () => {},
  });
  return { manager, controller, events, snapshot: () => snapshot };
}
test('authenticated invitation posts native UI in beforeConnect while peer transport remains stalled', async () => {
  const f = fixture(), data = parseCallPush(payload())!, signal = new AbortController().signal;
  let finish!: () => void;
  const coordinator = new WakeSyncCoordinator(async () => ({ connect: async () => { f.events.push('rtc-connect'); }, release: async () => {} }), Date.now,
    { set: callback => { finish = callback; }, clear: () => {} });
  const running = coordinator.run({ legacy: false, kind: 'call', id: callId, expiresAt: Date.now() + 30000 }, () => applyCallPush(f.manager, data, signal));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(f.events.indexOf('native-ui') < f.events.indexOf('rtc-connect')); assert.equal(f.snapshot().activeCall?.session.status, 'connecting');
  assert.equal(f.events.includes('microphone'), false); f.controller.update(f.snapshot(), f.manager);
  assert.equal(f.events.filter(item => item === 'native-ui').length, 1);
  finish(); await running; f.manager.endCall(); f.controller.update(f.snapshot(), f.manager);
});
test('terminal hint is only a matched authenticated fetch trigger, never a local end action', async () => {
  const f = fixture(); await f.manager.openCallPush(); const signal = new AbortController().signal;
  const state = parseCallPush(terminal())!; await applyCallPush(f.manager, state, signal);
  assert.deepEqual(f.events.slice(-2), ['directory', 'state-fetch']); assert.equal(f.snapshot().activeCall?.session.callId, callId);
  if (state.type !== 'state') throw new Error('fixture');
  const before = f.events.length;
  await applyCallPush(f.manager, { ...state, serverEpoch: 'cc'.repeat(16) }, signal);
  await applyCallPush(f.manager, { ...state, callId: 'dd'.repeat(16) }, signal);
  assert.equal(f.events.length, before);
  const aborted = new AbortController(); aborted.abort(); await applyCallPush(f.manager, state, aborted.signal); assert.equal(f.events.length, before);
  f.manager.endCall(); f.controller.update(f.snapshot(), f.manager);
});
test('forged invitation rejection and an aborted task never produce native ringing or microphone work', async () => {
  const f = fixture(), push = parseCallPush(payload())!;
  f.manager.openCallPush = async () => { throw new Error('not authenticated'); };
  await assert.rejects(applyCallPush(f.manager, push, new AbortController().signal), /authenticated/); assert.deepEqual(f.events, []);
  const aborted = new AbortController(); aborted.abort(); await applyCallPush(f.manager, push, aborted.signal); assert.deepEqual(f.events, []);
});
