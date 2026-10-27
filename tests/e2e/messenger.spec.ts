import { createHash } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { PeerSession } from '../../packages/core/src/index.js';

type DiagnosticWindow = Window & { __session: PeerSession; __testTracks?: MediaStreamTrack[] };
const serverUrl = `http://127.0.0.1:${process.env.PW_SERVER_PORT || '8799'}`;
const probeUrl = `http://127.0.0.1:${process.env.PW_PROBE_PORT || '5174'}`;
async function ready(page: Page, state = 'connected') {
  await expect(page.getByTestId('status')).toHaveAttribute('data-state', state);
}
async function callState(page: Page, state: string) {
  await expect(page.getByTestId('call-state')).toHaveAttribute('data-state', state);
}
async function fillConnection(page: Page, invite: string) {
  await page.getByTestId('server-url').fill(serverUrl);
  await page.getByTestId('invite').fill(invite);
}
async function pair(browser: Browser, relayOnly = false) {
  const contexts: BrowserContext[] = [];
  for (let i = 0; i < 2; i++) contexts.push(await browser.newContext({ permissions: ['microphone', 'camera'] }));
  const [ca, cb] = contexts;
  const a = await ca!.newPage(), b = await cb!.newPage();
  await Promise.all([a.goto(probeUrl), b.goto(probeUrl)]);
  await a.getByTestId('generate').click();
  const invite = await a.getByTestId('invite').inputValue();
  await fillConnection(a, invite); await fillConnection(b, invite);
  if (relayOnly) { await a.getByTestId('relay-only').check(); await b.getByTestId('relay-only').check(); }
  await a.getByTestId('connect').click(); await ready(a, 'waiting');
  await b.getByTestId('connect').click(); await Promise.all([ready(a), ready(b)]);
  return { a, b, contexts, invite };
}
async function send(page: Page, text: string) {
  await page.getByTestId('message-input').fill(text);
  await page.getByTestId('send-message').click();
}
async function retainTracks(page: Page) {
  await page.evaluate(() => {
    const w = window as DiagnosticWindow; const state = w.__session.getSnapshot();
    w.__testTracks = state.localStream?.getTracks() ?? [];
  });
}
async function allTracksEnded(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const w = window as DiagnosticWindow;
    return (w.__testTracks?.length ?? 0) > 0 && w.__testTracks?.every((track) => track.readyState === 'ended');
  })).toBe(true);
}
async function beginCall(caller: Page, receiver: Page, video = false) {
  await caller.getByTestId(video ? 'video-call' : 'audio-call').click();
  await callState(receiver, 'incoming');
  await receiver.getByTestId('accept-call').click();
  await Promise.all([callState(caller, 'active'), callState(receiver, 'active')]);
  // Require real remote media tracks, not merely the invitation/accept flags.
  for (const page of [caller, receiver]) await expect.poll(() => page.evaluate(() => {
    const stream = (window as DiagnosticWindow).__session.getSnapshot().remoteStream;
    return stream?.getAudioTracks().filter((track) => track.readyState === 'live').length ?? 0;
  })).toBeGreaterThan(0);
}
async function hangup(caller: Page, receiver: Page) {
  await Promise.all([retainTracks(caller), retainTracks(receiver)]);
  await caller.getByTestId('end-call').click();
  await Promise.all([callState(caller, 'idle'), callState(receiver, 'idle')]);
  await Promise.all([allTracksEnded(caller), allTracksEnded(receiver)]);
  for (const page of [caller, receiver]) await expect.poll(() => page.getByTestId('remote-video').evaluate((element) => (element as HTMLVideoElement).srcObject === null)).toBe(true);
}

test('two separate browser contexts exchange chat and exact file bytes', async ({ browser }) => {
  const { a, b, contexts } = await pair(browser);
  try {
    const text = 'Привет! <img src=x onerror=alert(1)> & связь напрямую';
    await send(a, text); await expect(b.getByTestId('messages')).toContainText(text);
    await expect(b.getByTestId('messages').locator('img')).toHaveCount(0);
    await send(b, 'Ответ со второго устройства');
    await expect(a.getByTestId('messages')).toContainText('Ответ со второго устройства');
    const bytes = Buffer.from(Array.from({ length: 40_123 }, (_, i) => (i * 31) % 256));
    await a.getByTestId('file-input').setInputFiles({ name: 'несколько-частей.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await expect.poll(() => b.evaluate(() => (window as DiagnosticWindow).__session.getSnapshot().files.find((file) => file.name === 'несколько-частей.bin')?.status)).toBe('complete');
    const hash = await b.evaluate(async () => {
      const file = (window as DiagnosticWindow).__session.getSnapshot().files.find((entry) => entry.name === 'несколько-частей.bin');
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(file!.data!));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    await expect(a.locator('[data-file-name="несколько-частей.bin"]')).toHaveAttribute('data-status', 'complete');
    await b.getByTestId('file-input').setInputFiles({ name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) });
    await expect.poll(() => a.evaluate(() => {
      const file = (window as DiagnosticWindow).__session.getSnapshot().files.find((entry) => entry.name === 'empty.bin');
      return file && { status: file.status, length: file.data?.length };
    })).toEqual({ status: 'complete', length: 0 });
    const download = a.waitForEvent('download');
    await a.locator('[data-file-name="empty.bin"]').getByRole('link', { name: 'Скачать' }).click();
    expect((await download).suggestedFilename()).toBe('empty.bin');
    await expect(a.getByTestId('route')).toHaveAttribute('data-route', 'direct');
    await expect(b.getByTestId('route')).toHaveAttribute('data-route', 'direct');
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('audio calls work in both directions, mute and repeat calls release every track', async ({ browser }) => {
  const { a, b, contexts } = await pair(browser);
  try {
    await beginCall(a, b);
    await a.getByTestId('mute').click();
    await expect.poll(() => a.evaluate(() => {
      const state = (window as DiagnosticWindow).__session.getSnapshot();
      return state.muted && state.localStream?.getAudioTracks().every((track) => !track.enabled);
    })).toBe(true);
    await hangup(a, b);
    await beginCall(b, a); await hangup(b, a);
    await beginCall(a, b); await hangup(b, a);
    await send(a, 'Чат работает после трёх звонков');
    await expect(b.getByTestId('messages')).toContainText('Чат работает после трёх звонков');
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('video calls receive real frames and can be rejected', async ({ browser }) => {
  const { a, b, contexts } = await pair(browser);
  try {
    await a.getByTestId('video-call').click(); await callState(b, 'incoming');
    await b.getByTestId('reject-call').click(); await Promise.all([callState(a, 'idle'), callState(b, 'idle')]);
    await beginCall(b, a, true);
    for (const page of [a, b]) {
      await expect.poll(() => page.getByTestId('remote-video').evaluate((node) => {
        const video = node as HTMLVideoElement;
        return video.videoWidth > 0 && video.readyState >= 2 && video.getVideoPlaybackQuality().totalVideoFrames > 0;
      })).toBe(true);
    }
    await hangup(a, b);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('a surviving participant reconnects when either peer leaves first', async ({ browser }) => {
  const { a, b, contexts } = await pair(browser);
  try {
    // Original initiator leaves first; the previous responder survives.
    await a.getByTestId('disconnect').click(); await ready(b, 'waiting');
    await a.getByTestId('connect').click(); await Promise.all([ready(a), ready(b)]);
    await send(a, 'После переподключения первого'); await expect(b.getByTestId('messages')).toContainText('После переподключения первого');
    await b.getByTestId('disconnect').click(); await ready(a, 'waiting');
    await b.getByTestId('connect').click(); await Promise.all([ready(a), ready(b)]);
    await send(b, 'После переподключения второго'); await expect(a.getByTestId('messages')).toContainText('После переподключения второго');
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('relay-only explicitly fails without configured TURN', async ({ page }) => {
  test.skip(process.env.PW_TEST_TURN === '1', 'TURN infrastructure is configured for this run');
  await page.goto(probeUrl); await page.getByTestId('generate').click();
  await page.getByTestId('server-url').fill(serverUrl); await page.getByTestId('relay-only').check();
  await page.getByTestId('connect').click(); await ready(page, 'error');
  await expect(page.getByTestId('error')).toContainText('requires a configured TURN server');
  await expect(page.getByTestId('route')).toHaveAttribute('data-route', 'unknown');
});


test('authenticated TURN carries forced-relay chat, files and bidirectional audio', async ({ browser }) => {
  test.skip(process.env.PW_TEST_TURN !== '1', 'Set PW_TEST_TURN=1 with explicit TURN_URLS and TURN_SHARED_SECRET');
  const { a, b, contexts } = await pair(browser, true);
  try {
    for (const page of [a, b]) await expect(page.getByTestId('route')).toHaveAttribute('data-route', 'relay');
    await send(a, 'Текст через наш TURN'); await expect(b.getByTestId('messages')).toContainText('Текст через наш TURN');
    const bytes = Buffer.from(Array.from({ length: 30_000 }, (_, i) => i % 251));
    await b.getByTestId('file-input').setInputFiles({ name: 'relay.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await expect.poll(() => a.evaluate(() => (window as DiagnosticWindow).__session.getSnapshot().files.find((file) => file.name === 'relay.bin')?.status)).toBe('complete');
    const hash = await a.evaluate(async () => {
      const data = (window as DiagnosticWindow).__session.getSnapshot().files.find((file) => file.name === 'relay.bin')!.data!;
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    await beginCall(a, b);
    // Bitrate is derived from real outbound RTP byte counters across two samples.
    for (const page of [a, b]) await expect.poll(() => page.evaluate(() => (window as DiagnosticWindow).__session.getSnapshot().stats.audioBitrateKbps ?? 0)).toBeGreaterThan(0);
    await hangup(a, b);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
