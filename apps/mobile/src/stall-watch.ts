import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { STALL_MS, addStall, formatStall, type Stall } from './composer-model';

/**
 * Notes moments when the JavaScript thread did not run for a second or more (the app looked
 * frozen), with what was in progress then. Only times and fixed labels are kept, never message
 * text or names; the list goes into the connection report the person copies themselves.
 */
const TICK_MS = 250;
const file = () => new File(Paths.document, 'stalls.json');
const busy = new Map<string, number>();
let stalls: Stall[] | undefined;
let updates = 0;
let started = false;

function load(): Stall[] {
  if (stalls) return stalls;
  try { const saved = file().exists ? JSON.parse(file().textSync()) as Stall[] : []; stalls = Array.isArray(saved) ? saved : []; }
  catch { stalls = []; }
  return stalls;
}

/** Marks work in progress; the returned function ends it. */
export function busyWith(label: string): () => void {
  busy.set(label, (busy.get(label) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return; ended = true;
    const left = (busy.get(label) ?? 1) - 1;
    if (left > 0) busy.set(label, left); else busy.delete(label);
  };
}
export async function whileBusy<T>(label: string, work: () => Promise<T>): Promise<T> {
  const end = busyWith(label);
  try { return await work(); } finally { end(); }
}

/** Called for each change the messenger core reports; a burst of them points at the cause. */
export function countUpdate() { updates++; }

export function startStallWatch() {
  if (started) return; started = true;
  let last = Date.now();
  let busyAtTick: string[] = [];
  let updatesAtTick = 0;
  setInterval(() => {
    const now = Date.now();
    const late = now - last - TICK_MS;
    // Timers stop in the background; a long gap there is not a freeze the person saw.
    if (late >= STALL_MS && AppState.currentState === 'active') {
      const busyNow = [...new Set([...busyAtTick, ...busy.keys()])].sort();
      stalls = addStall(load(), { at: now, ms: late, busy: busyNow, updates: updates - updatesAtTick, state: AppState.currentState });
      try { file().write(JSON.stringify(stalls)); } catch { /* Kept in memory. */ }
    }
    last = now; busyAtTick = [...busy.keys()]; updatesAtTick = updates;
  }, TICK_MS);
}

export function stallReport(): string[] {
  const list = load();
  if (!list.length) return ['Freezes: none'];
  const offset = new Date().getTimezoneOffset();
  return ['Freezes (time · length · app · in progress · core updates):', ...list.map(stall => formatStall(stall, offset))];
}
