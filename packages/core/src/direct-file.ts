import { z } from 'zod';
import { peerIdSchema } from './protocol.js';
import { OUTBOX_TTL_MS } from './group-sync.js';

const kind = 'lastcall-file-timing';
const timingSchema = z.object({
  kind: z.literal(kind), version: z.literal(1), id: peerIdSchema,
  conversationId: z.string().regex(/^dm:[a-f0-9]{64}$/),
  timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(value => value.expiresAt - value.timestamp === OUTBOX_TTL_MS, 'Invalid direct file deadline');
export type DirectFileTiming = z.infer<typeof timingSchema>;

/** Opaque metadata keeps the existing strict file-start frame compatible. */
export function encodeDirectFileTiming(value: Omit<DirectFileTiming, 'kind' | 'version'>): string {
  return JSON.stringify(timingSchema.parse({ ...value, kind, version: 1 }));
}

export function parseDirectFileTiming(metadata: string | undefined, id: string, conversationId: string, now: number): DirectFileTiming | undefined {
  if (!metadata) return;
  let value: unknown;
  try { value = JSON.parse(metadata); } catch {
    if (/"kind"\s*:\s*"lastcall-file-timing"/.test(metadata)) throw new Error('Invalid direct file timing');
    return; // Legacy clients used optional opaque metadata without this envelope.
  }
  if (!value || typeof value !== 'object' || (value as { kind?: unknown }).kind !== kind) return;
  const timing = timingSchema.parse(value);
  if (timing.id !== id || timing.conversationId !== conversationId || timing.timestamp > now + 60000) throw new Error('Invalid direct file timing');
  if (now >= timing.expiresAt) throw new Error('Direct file expired');
  return timing;
}
