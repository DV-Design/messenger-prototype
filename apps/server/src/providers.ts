import { readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import {pushPreviewSchema,pushPreviewEnvelopeSchema,type WakeIntent} from '@messenger/core';

export interface SMSProvider { sendCode(phone: string, code: string): Promise<void>; dispose?(): Promise<void> }
export interface PushProvider { sendWake(token: string, intent?: WakeIntent, backgroundSync?: boolean,preview?:string): Promise<void>; dispose?(): Promise<void> }
export class InvalidPushToken extends Error { constructor() { super('Push token is no longer valid'); } }

/** Generic metadata or an opted-in opaque encrypted preview; expired intents never reach FCM. */
export function buildFcmWakeMessage(token: string, intent?: WakeIntent, now = Date.now(), backgroundSync = false,preview?:string): Message | undefined {
  const expiresAt = intent ? Math.min(intent.expiresAt, now + (intent.kind === 'call' ? 30_000 : 60_000)) : now + 60_000;
  if (expiresAt <= now) return undefined;
  if(preview!==undefined){
    preview=pushPreviewSchema.parse(preview);const header=pushPreviewEnvelopeSchema.parse(JSON.parse(preview));
    if(!backgroundSync||!intent||(intent.kind!=='message'&&intent.kind!=='file')||header.kind!==intent.kind||header.intentId!==intent.intentId||header.expiresAt!==intent.expiresAt||intent.expiresAt>now+65000)throw new Error('Invalid encrypted preview delivery mode');
    const data={kind:'lastcall-wake',intentKind:intent.kind,intentId:intent.intentId,expiresAt:String(intent.expiresAt),preview};
    if(Buffer.byteLength(JSON.stringify(data),'utf8')>4096)throw new Error('Push data exceeds FCM payload limit');
    return {token,data,android:{priority:'high',ttl:expiresAt-now,restrictedPackageName:'dev.messenger.prototype'}};
  }
  const body = intent?.kind === 'call' ? 'Ожидается звонок. Откройте LastCall.' : intent?.kind === 'file' ? 'Ожидается отправка файла. Откройте LastCall.' : 'Ожидается отправка сообщения. Откройте LastCall.';
  // Calls use their own collapse class; no sender/conversation identifier is exposed.
  const collapse = intent?.kind === 'call' ? 'lastcall-call' : 'lastcall-wake';
  return {
    token, ...(!backgroundSync?{notification: { title: 'LastCall', body }}:{}),
    data: { kind: 'lastcall-wake', ...(backgroundSync?{title:'LastCall',message:body,channelId:'lastcall-messages',tag:collapse}:{}), ...(intent ? { intentKind: intent.kind, intentId: intent.intentId, expiresAt: String(expiresAt) } : {}) },
    android: { priority: 'high', ttl: expiresAt - now, collapseKey: collapse, restrictedPackageName: 'dev.messenger.prototype', ...(!backgroundSync?{notification: { channelId: 'lastcall-messages', tag: collapse }}:{}) },
  };
}

/** TLS POST only. No query credentials, body logging, fixed codes or SMS.ru test flag. */
export function createSmsRuProvider(apiId: string, fetcher: typeof fetch = fetch): SMSProvider {
  const controllers = new Set<AbortController>();
  return {
    async sendCode(phone, code) {
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher('https://sms.ru/sms/send', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ api_id: apiId, to: phone.slice(1), msg: `LastCall: код ${code}. Никому не сообщайте код.`, json: '1', ttl: '5' }),
        });
        if (!response.ok || !response.body) throw new Error('SMS provider request failed');
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 64 * 1024) { await reader.cancel(); throw new Error('SMS response exceeds limit'); } chunks.push(value); }
        } finally { reader.releaseLock(); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { status?: string; status_code?: number; sms?: Record<string, { status?: string; status_code?: number }> };
        const recipient = data.sms?.[phone.slice(1)];
        if (data.status !== 'OK' || data.status_code !== 100 || recipient?.status !== 'OK' || recipient.status_code !== 100) throw new Error('SMS provider rejected request');
      } catch { throw new Error('SMS provider could not accept verification request'); }
      finally { clearTimeout(timeout); controllers.delete(controller); }
    },
    async dispose() { for (const controller of controllers) controller.abort(); controllers.clear(); },
  };
}

/** Returns undefined for missing/invalid credentials; capabilities then remain honestly disabled. */
export function createFcmPushProvider(credentialsPath: string): PushProvider | undefined {
  try {
    if (statSync(credentialsPath).size > 64 * 1024) return undefined;
    const file = readFileSync(credentialsPath);
    const account = JSON.parse(file.toString('utf8')) as { project_id?: unknown; client_email?: unknown; private_key?: unknown };
    if (typeof account.project_id !== 'string' || typeof account.client_email !== 'string' || typeof account.private_key !== 'string') return undefined;
    const app = initializeApp({ credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key }), projectId: account.project_id }, `lastcall-${randomBytes(8).toString('hex')}`);
    const messaging = getMessaging(app);
    return {
      async sendWake(token, intent, backgroundSync = false,preview) {
        try {
          const message = buildFcmWakeMessage(token, intent, Date.now(), backgroundSync,preview);
          if (message) await messaging.send(message);
        } catch (error) {
          const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') throw new InvalidPushToken();
          throw new Error('Push provider could not accept notification');
        }
      },
      async dispose() { await deleteApp(app); },
    };
  } catch { return undefined; }
}
