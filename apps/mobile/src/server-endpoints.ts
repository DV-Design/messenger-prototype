import { File, Paths } from 'expo-file-system';
import { orderedCandidates, validEndpoints } from './server-endpoints-model';

/**
 * Which server this phone talks to. The account's address (p2p.lienad.ru) never changes: local
 * history is keyed by it. After sign-in the server tells signed-in clients its addresses, primary
 * first (the Italian server), which are kept on the phone only; at start the phone uses the first
 * that answers, and the account's own address is always the last resort (it forwards to the
 * primary while that is up).
 */
const file = () => new File(Paths.document, 'server-endpoints.json');
let cache: string[] | undefined;

export function savedEndpoints(): string[] {
  if (cache) return cache;
  try { const stored = file(); cache = stored.exists ? validEndpoints(JSON.parse(stored.textSync())) : []; } catch { cache = []; }
  return cache;
}

export function saveEndpoints(list: string[]) {
  const next = validEndpoints(list);
  if (JSON.stringify(next) === JSON.stringify(savedEndpoints())) return;
  cache = next;
  try { file().write(JSON.stringify(next)); } catch { /* kept for this run */ }
}

async function answers(url: string, ms: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { const response = await fetch(`${url}/health`, { signal: controller.signal }); return response.ok; }
  catch { return false; } finally { clearTimeout(timer); }
}

/** The first address that answers, trying the primary first; `skip` leaves out one that just failed. */
export async function chooseServer(home: string, skip?: string): Promise<string> {
  const candidates = orderedCandidates(savedEndpoints(), home);
  const own = candidates[candidates.length - 1]!;
  for (const url of candidates) {
    if (url === own) return own;
    if (url !== skip && await answers(url, 3000)) return url;
  }
  return own;
}
